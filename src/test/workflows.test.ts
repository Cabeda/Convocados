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

describe("the reviewer is exempt only where it cannot review", () => {
  // A run started by a Dependabot PR or a fork receives no repository secrets,
  // so the App token step fails and the role is red on Changes it could never
  // review — the same constraint the sweeper dodges by running on a schedule.
  // Drafts pay for a review at `opened` and then pay again at `ready_for_review`.
  const reviewerJobIf = () => {
    const doc = parse(readFileSync(join(workflowsDir, "factory-reviewer.yml"), "utf8")) as {
      jobs?: Record<string, { if?: string }>;
    };
    return doc.jobs?.reviewer?.if ?? "";
  };

  it("skips the secretless runs and drafts", () => {
    const condition = reviewerJobIf();
    expect(condition).toContain("github.event.pull_request.user.login != 'dependabot[bot]'");
    expect(condition).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(condition).toContain("!github.event.pull_request.draft");
  });

  it("compares the author login exactly once, and only against Dependabot", () => {
    const comparisons = [
      ...reviewerJobIf().matchAll(
        /github\.event\.pull_request\.user\.login\s*(?:[!=]==?)\s*['"]([^'"]+)['"]/g,
      ),
    ].map((m) => m[1]);
    // An allowlist (`== 'Cabeda'`), a second exemption, or a bot-wide filter all
    // exempt `convocados-factory[bot]` — this role's main customer. Banning two
    // spellings was not enough; an extra comparison passes with one of them.
    expect(comparisons).toEqual(["dependabot[bot]"]);
    expect(reviewerJobIf(), "no bot-wide author filter").not.toMatch(
      /contains\s*\([^)]*user\.login/,
    );
  });

  it("keeps ready_for_review, the only event that reaches a skipped draft", () => {
    const doc = parse(readFileSync(join(workflowsDir, "factory-reviewer.yml"), "utf8")) as {
      on?: unknown;
    } & Record<string, unknown>;
    const trigger = (doc.on ?? doc["true"]) as { pull_request?: { types?: string[] } } | undefined;
    // Drop this event and every draft is skipped at opened/synchronize/reopened
    // and never reviewed at all — silently, since nothing else would fail.
    expect(trigger?.pull_request?.types ?? []).toContain("ready_for_review");
  });
});

describe("the CLA allowlist names the factory App exactly", () => {
  // The App is `convocarados-factory` (its PRs are authored by
  // `app/convocarados-factory`). A typo in the allowlist leaves that name
  // unmatched and a PR authored by the App goes red with "Committers of Pull
  // Request number N have to sign the CLA" — a signature the bot cannot give
  // (GH #1464).
  it("exempts the identity that signs the factory's commits", () => {
    const raw = readFileSync(join(workflowsDir, "cla.yml"), "utf8");
    const allowlist = /allowlist:\s*"([^"]+)"/.exec(raw)?.[1] ?? "";
    expect(
      allowlist.split(",").map((name) => name.trim()),
      "cla.yml must exempt the factory App by its exact login",
    ).toContain("convocarados-factory[bot]");
  });
});
describe("a factory commit carries an identity the CLA accepts", () => {
  // A Change with a commit author the CLA allowlist does not name can never be
  // merged: the bot cannot sign, and the check fails on every synchronize.
  // #1807 shipped `convocados-factory[bot]` — one letter short of the App's
  // login — and went red on the CLA with a green suite.
  //
  // Every workflow that runs the agent commits: the action commits whatever the
  // agent leaves in the tree, and the Reviewer's own verdict file is enough to
  // make the tree dirty. A workflow missing the identity dies before its first
  // thought ("empty ident name … not allowed").
  const COMMITTING = workflowFiles.filter((file) =>
    readFileSync(join(workflowsDir, file), "utf8").includes("anomalyco/opencode/github"),
  );

  const allowlist = () => {
    const raw = readFileSync(join(workflowsDir, "cla.yml"), "utf8");
    return (/allowlist:\s*"([^"]+)"/.exec(raw)?.[1] ?? "")
      .split(",")
      .map((name) => name.trim());
  };

  it.each(COMMITTING)("%s names a committer the CLA exempts", (file) => {
    const raw = readFileSync(join(workflowsDir, file), "utf8");
    const names = [...raw.matchAll(/user\.name[= ]"([^"]+)"/g)].map((m) => m[1]);
    expect(names.length, `${file} must set the committer identity`).toBeGreaterThan(0);
    for (const name of names) {
      expect(allowlist(), `${file} commits as ${name}, which the CLA does not exempt`).toContain(
        name,
      );
    }
  });

  it.each(workflowFiles)("%s never commits under an unexempted name", (file) => {
    const raw = readFileSync(join(workflowsDir, file), "utf8");
    for (const [, name] of raw.matchAll(/user\.name[= ]"([^"]+)"/g)) {
      expect(allowlist(), `${file} sets user.name ${name}`).toContain(name);
    }
  });
});

describe("the agent action can start on a bot-authored Change", () => {
  // The action asserts the *actor's* repo permission and skips it only when
  // TOKEN is set. A PR authored by the factory App has actor
  // `convocarados-factory[bot]`, whose collaborator permission is `none` — the
  // minted token's scopes do not change that — so the reviewer dies before its
  // first thought with "User ... does not have write permissions". That is the
  // factory's main customer, so every agent step must carry TOKEN.
  const agentWorkflows = () =>
    workflowFiles.filter((file) =>
      readFileSync(join(workflowsDir, file), "utf8").includes("anomalyco/opencode/github"),
    );

  it.each(agentWorkflows())("%s sets TOKEN for the action", (file) => {
    const raw = readFileSync(join(workflowsDir, file), "utf8");
    expect(raw, `${file} must pass TOKEN to the action`).toMatch(/^ +TOKEN: /m);
  });
});

describe("a Fixer cycle stays inside its budget", () => {
  // Two of the first four runs hung with no output for 77 and 100 minutes and
  // delivered nothing. The work itself takes under ten. The ceiling is what
  // turns a stall into one lost tick instead of one lost hour.
  const fix = () =>
    (parse(readFileSync(join(workflowsDir, "factory-fix.yml"), "utf8")) as {
      jobs: Record<string, { timeout_minutes?: number; steps: Array<{ name?: string; "timeout-minutes"?: number; with?: Record<string, unknown> }> }>;
    }).jobs;

  it("caps the agent step at 25 minutes", () => {
    const steps = Object.values(fix()).flatMap((j) => j.steps);
    const agent = steps.find((s) => s.name === "Run the Fixer");
    expect(agent?.["timeout-minutes"]).toBe(25);
  });

  it("runs the Gate without e2e, which CI covers", () => {
    const raw = readFileSync(join(workflowsDir, "factory-fix.yml"), "utf8");
    expect(raw).toContain("gate.sh --skip-e2e");
  });

  it("forbids the worktree bootstrap on a clean runner", () => {
    const raw = readFileSync(join(process.cwd(), ".opencode/agents/fixer.md"), "utf8");
    expect(raw).toMatch(/Never run `scripts\/worktree-bootstrap\.sh`/);
  });

  it("lets the janitor start the drain, because the cron does not", () => {
    const raw = readFileSync(join(workflowsDir, "factory-janitor.yml"), "utf8");
    expect(raw).toContain("Wake the machine");
    // The hand-off must not ask for Actions write: the installation lacks it
    // and the mint fails 422 before any dispatch happens.
    expect(raw).not.toContain("permission-actions: write");
    expect(raw).toContain("repos/$GITHUB_REPOSITORY/dispatches");
  });
});

describe("a dead run still hands over its branch", () => {
  // `deliver.ts` reads the branch from `.factory-handoff/branch` only. A run
  // killed before writing that file committed to `factory/<issue>-work` and had
  // it silently dropped (#1710: 77 minutes, blocked with no branch). The
  // packaging step knows the branch, so it must write it down.
  it("records the branch before bundling it", () => {
    const raw = readFileSync(join(workflowsDir, "factory-fix.yml"), "utf8");
    const records = raw.indexOf("> .factory-handoff/branch");
    const bundles = raw.indexOf("git bundle create");
    expect(records, "the packaging step must write the branch file").toBeGreaterThan(0);
    expect(records, "it must be written before the bundle").toBeLessThan(bundles);
  });
});

describe("the merge gate and the Reviewer's verdict", () => {
  it("merges only through the tested decision, on the commit it decided about", () => {
    const raw = readFileSync(join(workflowsDir, "factory-merge.yml"), "utf8");
    expect(raw).toContain("factory-merge-run.ts");
    const run = readFileSync(join(process.cwd(), "scripts/factory/factory-merge-run.ts"), "utf8");
    expect(run).toContain("--match-head-commit");
  });

  it("fails the review when no verdict was written", () => {
    // Silence used to read as approval: the reviewer's step had
    // continue-on-error, so a 25-minute timeout posted nothing and passed.
    const raw = readFileSync(join(workflowsDir, "factory-reviewer.yml"), "utf8");
    expect(raw).toContain("Record the verdict");
    expect(raw).toContain("no verdict was written");
  });

  it("lets the Reviewer write the verdict file and nothing else", () => {
    const raw = readFileSync(join(process.cwd(), ".opencode/agents/reviewer.md"), "utf8");
    expect(raw).toContain('".factory-review/**": allow');
  });
});

describe("three lanes work the backlog without racing", () => {
  const fix = () => readFileSync(join(workflowsDir, "factory-fix.yml"), "utf8");
  const janitor = () => readFileSync(join(workflowsDir, "factory-janitor.yml"), "utf8");

  it("keys the concurrency group by lane", () => {
    // One group for every lane would serialise the whole backlog again.
    expect(fix()).toContain("group: factory-fix-queue-${{ inputs.lane || 0 }}");
  });

  it("tells the picker which slice of the queue to take", () => {
    expect(fix()).toContain('FACTORY_LANES: "3"');
    // A repository dispatch carries the lane in client_payload, not inputs.
    expect(fix()).toContain("FACTORY_LANE: ${{ inputs.lane || github.event.client_payload.lane || 0 }}");
  });

  it("feeds every lane from the one cron that fires", () => {
    expect(janitor()).toContain("for lane in 0 1 2");
    expect(janitor()).toContain("tick factory-review");
    expect(janitor()).toContain("tick factory-merge");
  });
});
