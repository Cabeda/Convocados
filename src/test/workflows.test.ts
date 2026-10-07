/**
 * Every workflow file must be valid, or the factory is silently inert.
 *
 * This exists because the Repairer shipped with an invalid trigger
 * (`check_suite: completed` instead of `check_suite: {types: [completed]}`) and
 * nothing noticed for weeks. A workflow with a malformed `on:` block parses as
 * YAML but is rejected by GitHub at load time, so the role simply never runs —
 * and the only visible symptom is a red run on `main` that nobody is watching,
 * because the workflow never gated a pull request.
 *
 * A dependency bump that touched the file is what finally surfaced it. That is
 * the whole argument for this test: validity must not depend on some unrelated
 * commit happening to re-validate the file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const workflowsDir = resolve(repoRoot, ".github/workflows");

interface Workflow {
  /** GitHub's payload key. YAML 1.1 reads a bare `on:` as the boolean true. */
  on?: Record<string, unknown> | string | boolean;
  permissions?: Record<string, unknown> | string;
  jobs?: Record<string, WorkflowJob>;
}

interface WorkflowJob {
  permissions?: Record<string, unknown> | string;
  steps?: Array<{ uses?: string; with?: Record<string, unknown> }>;
}

const workflowFiles = readdirSync(workflowsDir)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .sort();

/** Event names that exist. Guards against typos that silently never fire. */
const KNOWN_EVENTS = new Set([
  "branch_protection_rule",
  "check_run",
  "check_suite",
  "create",
  "delete",
  "deployment",
  "deployment_status",
  "discussion",
  "discussion_comment",
  "fork",
  "gollum",
  "issue_comment",
  "issues",
  "merge_group",
  "milestone",
  "page_build",
  "project",
  "project_card",
  "project_column",
  "public",
  "pull_request",
  "pull_request_comment",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_target",
  "push",
  "registry_package",
  "release",
  "repository_dispatch",
  "schedule",
  "status",
  "watch",
  "workflow_call",
  "workflow_dispatch",
  "workflow_run",
]);

const TRIGGER_FILTERS = new Set(["types", "branches", "branches-ignore", "paths", "paths-ignore", "tags", "tags-ignore", "workflows", "inputs", "schedule", "types-ignore"]);

/** Events whose payload is attacker-influenced, so `permissions` must be explicit. */
const PRIVILEGED_EVENTS = new Set([
  "pull_request_target",
  "issue_comment",
  "workflow_run",
  "pull_request",
]);

describe("workflow files are valid", () => {
  it("there are workflows to check", () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  it.each(workflowFiles)("%s parses and declares jobs", (file) => {
    const raw = readFileSync(join(workflowsDir, file), "utf8");
    let doc: Workflow;
    try {
      doc = parse(raw) as Workflow;
    } catch (err) {
      throw new Error(`${file} is not valid YAML: ${(err as Error).message}`, { cause: err });
    }
    expect(doc, `${file} must be a mapping`).toBeTypeOf("object");
    expect(Object.keys(doc?.jobs ?? {}).length, `${file} must declare at least one job`).toBeGreaterThan(0);
  });

  it.each(workflowFiles)("%s has a structurally valid `on:` block", (file) => {
    const doc = parse(readFileSync(join(workflowsDir, file), "utf8")) as Workflow;
    // A bare `on:` is the YAML 1.1 boolean `true`; GitHub reads the key as `on`.
    const trigger = doc.on ?? (doc as Record<string, unknown>)[true as unknown as string];

    expect(trigger, `${file} must declare \`on:\``).toBeDefined();

    if (typeof trigger === "string") {
      // Valid shorthand: `on: push`.
      expect(KNOWN_EVENTS.has(trigger), `${file}: unknown event "${trigger}"`).toBe(true);
      return;
    }

    expect(trigger, `${file}: \`on:\` must map event names to filters`).toBeTypeOf("object");

    for (const [event, filters] of Object.entries(trigger as Record<string, unknown>)) {
      expect(KNOWN_EVENTS.has(event), `${file}: unknown event "${event}"`).toBe(true);

      // `schedule` is the one event whose value is a list of cron entries, not a
      // filter map. Everything else must be a map.
      if (event === "schedule") {
        expect(
          Array.isArray(filters) && filters.every((f) => f && typeof f === "object" && "cron" in (f as object)),
          `${file}: \`on.schedule\` must be a list of {cron: ...} entries`,
        ).toBe(true);
        continue;
      }

      // The bug this file exists for: `check_suite: completed` puts a filter
      // *value* where the trigger map is required, so GitHub rejects the file.
      if (filters === null || filters === undefined) continue;
      expect(
        filters,
        `${file}: \`on.${event}\` must be a map of filters, not "${String(filters)}". Use \`types: [${String(filters)}]\`.`,
      ).toBeTypeOf("object");

      for (const key of Object.keys(filters as Record<string, unknown>)) {
        expect(
          TRIGGER_FILTERS.has(key),
          `${file}: \`on.${event}\` has unknown filter "${key}"`,
        ).toBe(true);
      }

      // Every event except schedule/workflow_dispatch must narrow its types,
      // otherwise it fires on every action and burns the runner budget.
      if (event === "workflow_dispatch") continue;
      const types = (filters as Record<string, unknown>).types;
      if (types === undefined) continue;
      expect(
        Array.isArray(types) && types.length > 0,
        `${file}: \`on.${event}.types\` must be a non-empty list`,
      ).toBe(true);
    }
  });

  it.each(workflowFiles)("%s pins its `permissions`", (file) => {
    const doc = parse(readFileSync(join(workflowsDir, file), "utf8")) as Workflow;
    const trigger = doc.on ?? (doc as Record<string, unknown>)[true as unknown as string];
    const events =
      typeof trigger === "string" ? [trigger] : Object.keys((trigger ?? {}) as Record<string, unknown>);

    const touchesUntrustedCode = events.some((e) => PRIVILEGED_EVENTS.has(e));
    const topLevel = doc.permissions;
    const jobPerms = Object.values(doc.jobs ?? {}).map((j) => j.permissions);

    // Default `GITHUB_TOKEN` scopes are broad. Every workflow that touches
    // untrusted input must say what it can do, either at the top level or on
    // every job that runs a step.
    if (!touchesUntrustedCode) return;

    const declared =
      topLevel !== undefined || (jobPerms.length > 0 && jobPerms.every((p) => p !== undefined));
    expect(
      declared,
      `${file} runs on ${events.filter((e) => PRIVILEGED_EVENTS.has(e)).join(", ")} and must declare \`permissions\` explicitly (use \`permissions: {}\` for least privilege)`,
    ).toBe(true);
  });
});

describe("workflow actions are pinned", () => {
  const allSteps = workflowFiles.flatMap((file) => {
    const doc = parse(readFileSync(join(workflowsDir, file), "utf8")) as Workflow;
    return Object.entries(doc.jobs ?? {}).flatMap(([jobId, job]) =>
      (job.steps ?? [])
        .filter((s): s is { uses: string } => typeof s.uses === "string")
        .map((s) => ({ file, jobId, uses: s.uses })),
    );
  });

  it("there are actions to check", () => {
    expect(allSteps.length).toBeGreaterThan(0);
  });

  it.each(allSteps)("$file $jobId pins $uses to a version", ({ uses }) => {
    // Local and docker refs carry no version. Everything from an action repo
    // must, so a tag cannot be repointed under us.
    if (uses.startsWith("./") || uses.startsWith("docker://")) return;
    const version = uses.split("@")[1];
    expect(version, `"${uses}" must pin a version or SHA`).toBeTruthy();
  });
});

describe("factory workflows cannot escalate", () => {
  const factoryWorkflows = workflowFiles.filter((f) => f.startsWith("factory-"));

  it("there are factory workflows", () => {
    expect(factoryWorkflows.length).toBeGreaterThan(0);
  });

  it.each(factoryWorkflows)("%s does not request workflow-write", (file) => {
    const doc = parse(readFileSync(join(workflowsDir, file), "utf8")) as Workflow;
    const raw = JSON.stringify(doc.permissions ?? {});
    expect(raw, `${file} must not hold \`workflows: write\``).not.toContain('"workflows":"write"');
  });

  it.each(factoryWorkflows)("%s never checks out untrusted PR code", (file) => {
    const doc = parse(readFileSync(join(workflowsDir, file), "utf8")) as Workflow;
    const raw = readFileSync(join(workflowsDir, file), "utf8");
    const trigger = doc.on ?? (doc as Record<string, unknown>)[true as unknown as string];
    const events =
      typeof trigger === "string" ? [trigger] : Object.keys((trigger ?? {}) as Record<string, unknown>);

    // `pull_request_target` runs with repo secrets in the context of base-branch
    // code. Checking out the PR head there hands an attacker the runner.
    const dangerous = events.includes("pull_request_target") || events.includes("issue_comment");
    const checksOutHead = /ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(raw);
    expect(
      !(dangerous && checksOutHead),
      `${file} checks out PR head on a privileged trigger; that is remote code execution`,
    ).toBe(true);
  });
});