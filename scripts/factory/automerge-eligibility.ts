/**
 * Auto-merge eligibility.
 *
 * Pure predicates over PR facts, with no I/O, so the merge decision is
 * deterministic and reviewable. Deliberately *not* an agent: an LLM's merge
 * judgement is unauditable and not reproducible, whereas this is a list of
 * named conditions a human can read, argue with, and test.
 *
 * The bar is "a merge that cannot surprise anyone". Every condition below
 * exists because its absence produced a real incident:
 *
 * - `mustNotBeBehind` — #1256 carried a pnpm-lock.yaml generated before the
 *   sharp override landed. Merging it would have reverted the pin and put
 *   Dependency Audit back to red on main. The PR's own CI was green because
 *   CI ran on a branch that did not have the override.
 * - `mustHaveGateEvidence` — a check that never ran must not read as "passed".
 *   "No conclusion" and "success" are different things, and conflating them is
 *   how a green tick hides a gate that is silently skipping.
 * - `author must be dependabot` — this covers machine-authored dependency
 *   bumps only. A human's Change always gets a human, no matter how green.
 */

export interface Check {
  /** Job name as GitHub reports it. */
  name: string;
  /** null while pending or queued. */
  conclusion: string | null;
}

export interface PullRequestFacts {
  number: number;
  author: string;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  /** GitHub's own conflict assessment. */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** Commits on head that base does not have. */
  commitsBehindBase: number;
  labels: string[];
  checks: Check[];
}

/**
 * Checks that must be present *and* successful. A missing check is not a pass.
 *
 * `CI` and `Analyze (javascript-typescript)` are the two contexts the `main`
 * rulesets actually mark required — verified against
 * `repos/Cabeda/Convocados/rulesets`, not guessed. `Typecheck`, `Lint`,
 * `Dependency Audit` and `Build` are the individual gates that `CI` aggregates,
 * and they are named separately so that a red member cannot hide behind a green
 * aggregate.
 *
 * `Coverage Gate` is deliberately absent: it reports `skipped` on
 * dependency-only diffs, so requiring it would make every Dependabot PR
 * ineligible. Pinned by a test so nobody re-adds it without meeting that.
 */
export const REQUIRED_CHECKS = [
  "CI",
  "Analyze (javascript-typescript)",
  "Typecheck",
  "Lint",
  "Dependency Audit",
  "Build",
] as const;

export interface Verdict {
  eligible: boolean;
  /** Human-readable reasons. Every failure is reported, not just the first. */
  reasons: string[];
}

/** Label that parks a Change. Present means a human is already engaged. */
const BLOCKED_LABEL = "factory:blocked";

export const DEPENDABOT_AUTHOR = "dependabot[bot]";

export function decideAutomerge(pr: PullRequestFacts): Verdict {
  const reasons: string[] = [];

  if (pr.author !== DEPENDABOT_AUTHOR) {
    reasons.push(
      `author is ${pr.author}, not ${DEPENDABOT_AUTHOR} — a human-authored Change always gets a human`,
    );
  }

  if (pr.baseRefName !== "main") {
    reasons.push(`base is ${pr.baseRefName}, not main`);
  }

  if (pr.isDraft) {
    reasons.push("is a draft");
  }

  if (pr.mergeable === "CONFLICTING") {
    reasons.push("has conflicts");
  } else if (pr.mergeable === "UNKNOWN") {
    // GitHub computes mergeability asynchronously. Treating UNKNOWN as
    // eligible is the exact failure mode where a merge races the answer.
    reasons.push("mergeability is UNKNOWN — GitHub has not finished computing it");
  }

  if (pr.labels.includes(BLOCKED_LABEL)) {
    reasons.push(`is labelled ${BLOCKED_LABEL}`);
  }

  if (pr.commitsBehindBase > 0) {
    reasons.push(
      `is ${pr.commitsBehindBase} commit(s) behind base — its CI proved nothing about the current base, and a stale lockfile can revert a fix that landed after it`,
    );
  }

  for (const required of REQUIRED_CHECKS) {
    const check = pr.checks.find((c) => c.name === required);
    if (!check) {
      reasons.push(`required check "${required}" never ran`);
    } else if (check.conclusion === null) {
      reasons.push(`required check "${required}" has not completed`);
    } else if (check.conclusion !== "success") {
      reasons.push(`required check "${required}" concluded ${check.conclusion}`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

/** One line per PR, for the run log and the audit comment. */
export function explain(pr: PullRequestFacts, verdict: Verdict): string {
  const head = verdict.eligible ? "eligible" : `not eligible: ${verdict.reasons.join("; ")}`;
  return `#${pr.number} (${pr.headRefName}) — ${head}`;
}
// ── Factory Changes: the two-way-door merge ──────────────────────────────────
//
// A factory Change is merged by a machine only when undoing it is cheap — Matt
// Pocock's two-way door: you can walk back through it. A migration, an auth
// route, a dependency bump or a workflow edit is a one-way door: the code
// reverts, but the data, the tokens or the pipeline do not. Those keep the
// human gate they always had.

export const FACTORY_AUTHOR = "app/convocarados-factory";
export const REVIEWED_MARKER = /<!-- factory:reviewed:([0-9a-f]{7,40}) -->/;
export const VERDICT_MARKER = /<!-- factory:verdict:(approve|refuse) -->/;

/** A path whose merge outlives a revert. Every entry is a real blast radius. */
export const ONE_WAY_PATHS: Array<{ match: RegExp; why: string }> = [
  { match: /^prisma\/migrations\//, why: "a database migration" },
  { match: /^prisma\/schema\.prisma$/, why: "a schema change" },
  { match: /^src\/lib\/auth[^/]*\.server\.ts$/, why: "auth and token handling" },
  { match: /^src\/pages\/api\/auth\//, why: "an auth route" },
  { match: /^src\/lib\/(oauth|tokens?)/, why: "OAuth and token handling" },
  { match: /^\.github\//, why: "the workflows that run the factory" },
  { match: /^AGENTS\.md$/, why: "the constitution" },
  { match: /^(package\.json|pnpm-lock\.yaml)$/, why: "dependencies" },
  { match: /^android-app\/(gradle|libs\.versions\.toml|.*\.gradle\.kts?$)/, why: "the Android build" },
  { match: /^(fly\.toml|Dockerfile|deploy\/)/, why: "deploy configuration" },
  { match: /^scripts\/(scheduler|server)/, why: "the scheduler" },
  { match: /^(vitest|stryker|playwright)\.config\./, why: "the measurement itself" },
];

export function isTwoWayDoor(files: string[]): Verdict {
  const reasons: string[] = [];
  for (const file of files) {
    const hit = ONE_WAY_PATHS.find((p) => p.match.test(file));
    if (hit) reasons.push(`${file} is ${hit.why} — a one-way door`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export interface ReviewRecord {
  head: string;
  verdict: "approve" | "refuse" | null;
}

/**
 * The newest review that names a head. Bodies from both issue comments and
 * formal reviews, oldest first, because a review may be posted either way.
 */
export function latestReview(bodies: string[]): ReviewRecord | null {
  for (let i = bodies.length - 1; i >= 0; i -= 1) {
    const head = REVIEWED_MARKER.exec(bodies[i] ?? "")?.[1];
    if (!head) continue;
    const verdict = VERDICT_MARKER.exec(bodies[i] ?? "")?.[1] as ReviewRecord["verdict"];
    return { head, verdict: verdict ?? null };
  }
  return null;
}

export interface FactoryFacts extends PullRequestFacts {
  files: string[];
  /** Comment and review bodies, oldest first. */
  reviewBodies: string[];
  headRefOid: string;
}

export function decideFactoryMerge(pr: FactoryFacts): Verdict {
  const reasons: string[] = [];

  if (pr.author !== FACTORY_AUTHOR) {
    reasons.push(`author is ${pr.author}, not the factory App`);
  }
  if (!pr.headRefName.startsWith("factory/")) {
    reasons.push(`head is ${pr.headRefName}, not a factory branch`);
  }
  if (pr.baseRefName !== "main") reasons.push(`base is ${pr.baseRefName}, not main`);
  if (pr.isDraft) reasons.push("is a draft");
  if (pr.mergeable === "CONFLICTING") reasons.push("has conflicts");
  else if (pr.mergeable === "UNKNOWN") {
    reasons.push("mergeability is UNKNOWN — GitHub has not finished computing it");
  }
  if (pr.labels.includes(BLOCKED_LABEL)) reasons.push(`is labelled ${BLOCKED_LABEL}`);
  if (pr.commitsBehindBase > 0) {
    reasons.push(`is ${pr.commitsBehindBase} commit(s) behind base — its CI proved nothing about the base it lands on`);
  }

  for (const required of REQUIRED_CHECKS) {
    const check = pr.checks.find((c) => c.name === required);
    if (!check) reasons.push(`required check "${required}" never ran`);
    else if (check.conclusion === null) reasons.push(`required check "${required}" has not completed`);
    else if (check.conclusion !== "success") reasons.push(`required check "${required}" concluded ${check.conclusion}`);
  }

  const door = isTwoWayDoor(pr.files);
  reasons.push(...door.reasons);

  const review = latestReview(pr.reviewBodies);
  if (!review) {
    reasons.push("no review has named its head");
  } else if (review.head !== pr.headRefOid) {
    reasons.push(`the newest review named ${review.head}, not the current head`);
  } else if (review.verdict !== "approve") {
    reasons.push(`the Reviewer's verdict on this head is ${review.verdict ?? "missing"}`);
  }

  return { eligible: reasons.length === 0, reasons };
}
