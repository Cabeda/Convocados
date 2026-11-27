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

  it("skips the event that can never read an App-authored Change", () => {
    // The action asserts the *actor's* repo permission. When the App pushed the
    // branch, the App is the actor and its permission is `none`, so this run
    // exits in two seconds without reading anything — and leaves a red
    // `reviewer` check on a head a scheduled run reviews fine. The predicate is
    // on the actor, which is what the failure is about: a human who pushes to a
    // factory branch is a human actor, and that run can review.
    expect(reviewerJobIf()).toContain("github.actor != 'convocarados-factory[bot]'");
    // Assert the complete set of author exemptions, not one member: an extra
    // `!= 'somebody'` exempts a human login from the `pull_request` run, and the
    // schedule only picks `factory/*` branches, so that login is then reviewed
    // by neither path.
    const comparisons = [
      ...reviewerJobIf().matchAll(
        /github\.event\.pull_request\.user\.login\s*(?:[!=]==?)\s*['"]([^'"]+)['"]/g,
      ),
    ].map((m) => m[1]);
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

describe("the reviewer check is the gate, not a comment", () => {
  // `reviewer` is a required status check, so a refusal has to fail it. #1866
  // showed "Verdict: refuse" beside a green reviewer job: the findings were
  // readable and mergeable anyway, which is a review nobody has to answer.
  const verdictStep = () => {
    const doc = parse(readFileSync(join(workflowsDir, "factory-reviewer.yml"), "utf8")) as {
      jobs?: Record<string, { steps?: Array<{ name?: string; run?: string }> }>;
    };
    return (doc.jobs?.reviewer?.steps ?? []).find((s) => s.name === "Record the verdict")?.run ?? "";
  };

  it("fails the check on refuse and on a missing verdict", () => {
    const run = verdictStep();
    // Two `exit 1`: one for `refuse`, one for the empty verdict. An approval is
    // the only path that leaves the check green.
    expect([...run.matchAll(/exit 1/g)]).toHaveLength(2);
    expect(run).toContain("approve) echo");
  });
});

describe("a run never leaves the checkout", () => {
  // A read outside the checkout resolves to a permission request, and an
  // unattended run has nobody to answer it: the step waits for its timeout and
  // dies with no verdict. That is what a `/tmp` scratch file did to every review
  // on 2026-11-27 — 25 minutes per run, no output.
  for (const agent of ["reviewer", "fixer"]) {
    it(`tells the ${agent} not to write outside the repository`, () => {
      const prompt = readFileSync(join(repoRoot, ".opencode", "agents", `${agent}.md`), "utf8");
      expect(prompt).toContain("Never touch a path outside this checkout");
      expect(prompt).toContain("/tmp");
    });
  }
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

  it("names a missing verdict instead of letting silence read as approval", () => {
    // Silence used to read as approval: the reviewer's step had
    // continue-on-error, so a 25-minute timeout posted nothing and passed.
    // The gate now refuses on the absent signature, so the check reports the
    // miss by name; it no longer reddens the Change for a decision the gate
    // already makes.
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

describe("a refused Change gets its round from the tick", () => {
  it("falls back to the picker on a dispatch with no PR", () => {
    // The reviewer signs a refuse and nothing happens until the loop runs; its
    // own cron is unreliable, so the tick must be able to start it.
    const raw = readFileSync(join(workflowsDir, "factory-fix-loop.yml"), "utf8");
    // Both dispatch events reach the same fallback: a manual tick with no input,
    // and the janitor's tick, which never carries a PR.
    expect(raw).toContain(
      'workflow_dispatch|repository_dispatch) pr="${DISPATCH_PR:-$(GITHUB_OUTPUT= node scripts/factory/next-fix.ts)}"',
    );
  });
});

describe("the answer loop is fed by the cron that actually fires", () => {
  // On 2026-11-27 the loop's own `*/30` schedule last fired at 09:50. Refusals
  // at 13:16 and 14:14 then sat with zero `factory:attempt` comments: the Fixer
  // never took a round, so 31 refused Changes waited on a tick that never came.
  // The janitor already stars `review` and `merge` from its `*/15`; the loop was
  // the one role left off the list.
  const fixLoop = () =>
    parse(readFileSync(join(workflowsDir, "factory-fix-loop.yml"), "utf8")) as {
      on?: unknown;
      jobs?: Record<string, { steps?: Array<{ env?: Record<string, string>; run?: string }> }>;
    } & Record<string, unknown>;

  it("accepts a factory-fix dispatch and reads the PR it carries", () => {
    const doc = fixLoop();
    const trigger = (doc.on ?? doc["true"]) as {
      repository_dispatch?: { types?: string[] };
    };
    expect(trigger.repository_dispatch?.types).toEqual(["factory-fix"]);

    const steps = doc.jobs?.ledger?.steps ?? [];
    const resolve = steps.find((step) => step.run?.includes("next-fix.ts"));
    expect(resolve?.env?.DISPATCH_PR).toContain("github.event.client_payload.pr");
    expect(resolve?.run).toContain("repository_dispatch)");
  });

  it("is ticked by the janitor, the cron that keeps its slot", () => {
    const janitor = readFileSync(join(workflowsDir, "factory-janitor.yml"), "utf8");
    expect(janitor).toContain("tick factory-fix");
    // The tick is unconditional: an empty queue must not stop a refused Change
    // from getting its round.
    expect(janitor.indexOf("tick factory-fix")).toBeGreaterThan(
      janitor.indexOf("tick factory-merge"),
    );
  });

  it("does not gate the dispatch on a PR the tick never sends", () => {
    const raw = readFileSync(join(workflowsDir, "factory-fix-loop.yml"), "utf8");
    expect(raw).not.toContain("github.event.client_payload.pr != null");
  });
});

describe("the review is readable where a human reads it", () => {
  // A formal review lands in a separate tab the conversation never shows, and
  // GitHub refuses one on an App-authored PR anyway. The adversarial review is
  // the product: it goes in the thread.
  it("posts the review as a PR comment", () => {
    const raw = readFileSync(join(workflowsDir, "factory-reviewer.yml"), "utf8");
    expect(raw).toContain('gh pr comment "$PR"');
    expect(raw).not.toContain("gh pr review");
  });
});

describe("a tick can start the round the Reviewer just refused", () => {
  // `ledger` already falls back to `next-fix.ts` when a dispatch carries no PR,
  // and nothing could reach that path: `pr` was a required input, so every
  // dispatch had to name one. A refusal therefore waited on a run that a newer
  // refusal cancelled — 31 Changes with findings and no round on 2026-11-27.
  it("does not require a PR number on dispatch", () => {
    const doc = parse(readFileSync(join(workflowsDir, "factory-fix-loop.yml"), "utf8")) as {
      on?: unknown;
    } & Record<string, unknown>;
    const trigger = (doc.on ?? doc["true"]) as {
      workflow_dispatch?: { inputs?: Record<string, { required?: boolean }> };
    };
    expect(trigger.workflow_dispatch?.inputs?.pr?.required).toBe(false);
  });
});

describe("every App token is minted under the input v3 keeps", () => {
  // #1875 renamed one workflow; the other eight sat on `app-id:` until a human
  // noticed. v3 accepts both and deprecates the old name, so nothing goes red —
  // and when v4 drops it every factory role silently stops minting a token.
  const files = () => readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"));

  it("never uses the deprecated app-id input", () => {
    for (const file of files()) {
      const raw = readFileSync(join(workflowsDir, file), "utf8");
      expect(/\n\s+app-id:/.test(raw), `${file} uses app-id:`).toBe(false);
    }
  });

  it("gives every create-github-app-token@v3 step a client-id", () => {
    for (const file of files()) {
      const doc = parse(readFileSync(join(workflowsDir, file), "utf8")) as {
        jobs?: Record<string, { steps?: Array<{ uses?: string; with?: Record<string, unknown> }> }>;
      };
      for (const [name, job] of Object.entries(doc.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (!/actions\/create-github-app-token@v3/.test(step.uses ?? "")) continue;
          expect(step.with?.["client-id"], `${file} ${name}: token step without client-id`).toBeDefined();
        }
      }
    }
  });
});

describe("a round's bundle carries the branch the push job fetches", () => {
  // The round job packages its work as a bundle and the push job fetches
  // `refs/heads/$branch` out of it. A range bundle (`origin/$branch..HEAD`)
  // stores its tip as `HEAD` with no ref, so that fetch fails with "couldn't
  // find remote ref" — the work is lost after its Attempt was already spent.
  // Reproduced on 2026-11-27 with PR #1815's round.
  it("names the ref instead of relying on a range", () => {
    const raw = readFileSync(join(workflowsDir, "factory-fix-loop.yml"), "utf8");
    // The command wraps across a continuation line, so match the command as a
    // block rather than per line.
    expect(raw).toMatch(/git bundle create[\s\S]{0,200}?refs\/heads\/\$branch/);
    expect(raw).not.toMatch(/git bundle create[\s\S]{0,120}?\.\.HEAD/);
  });
});
