/**
 * Nightshift merge decision — pure predicates, no I/O.
 *
 * This is the brain of the local auto-merge loop. On this repository a merge
 * deploys (release.yml fires on green main), so the bar is higher than "CI is
 * green": every guard below exists because its absence is a way a merge goes
 * wrong, and each one is named so a human can read, argue with, and test it.
 *
 * The decision is deliberately *not* an agent. A model chooses what to build;
 * it never chooses whether the result may land. `merge.ts` gathers facts and
 * acts on this verdict, nothing more.
 */

export interface Check {
  /** Job name as GitHub reports it. */
  name: string;
  /** null while pending or queued. */
  conclusion: string | null;
}

export interface MergeFacts {
  number: number;
  author: string;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  /** GitHub's own conflict assessment. */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** Commits on base that head does not have. */
  commitsBehindBase: number;
  labels: string[];
  checks: Check[];
  /** The PR's current head. */
  headSha: string;
  /** The SHA the check-runs were reported against. */
  checksSha: string;
  /** Additions + deletions, as GitHub reports them. */
  changedLines: number;
  /** Files changed, as GitHub reports them. */
  changedFiles: number;
  /** Review threads still open (not resolved/outdated). */
  reviewThreadsUnresolved: number;
  /** Logins whose review state is APPROVED. */
  approvals: string[];
  /** Post-change minus pre-change coverage percentage. Negative is a drop. */
  coverageDelta: number;
  /** Post-change minus pre-change mutation score. Negative is a drop. */
  mutationDelta: number;
  /** True when a coverage threshold in vitest.config.ts was lowered. */
  coverageThresholdsLowered: boolean;
  /** Every path the diff touches, repo-relative. */
  touchedPaths: string[];
}

export interface MergePolicy {
  /** Identities the loop is allowed to merge for. A human's Change is never here. */
  allowedAuthors: string[];
  /** Independent reviewer identities — none may equal the author. */
  requiredApprovers: string[];
  maxLines: number;
  maxFiles: number;
}

export interface Verdict {
  eligible: boolean;
  reasons: string[];
}

export const DEFAULT_POLICY: MergePolicy = {
  allowedAuthors: ["convocados-factory[bot]"],
  requiredApprovers: ["convocados-reviewer[bot]"],
  maxLines: 400,
  maxFiles: 20,
};

/**
 * A check that must be present *and* successful. A missing check is not a pass.
 *
 * `Coverage Gate` is deliberately **absent**: `test.yml` guards that job with
 * `if: github.event_name != 'pull_request'`, so it is skipped on every PR and
 * requiring it would make every Change permanently ineligible — the policy dead
 * on arrival. Coverage is enforced instead by the local gate (`gate.sh` runs
 * `vitest run --coverage` against the thresholds) and by the `coverageDelta` and
 * `coverageThresholdsLowered` guards below.
 *
 * `CI` and `Analyze (javascript-typescript)` are the two contexts the `main`
 * rulesets actually require; the individual gates `CI` aggregates are named
 * separately so a red member cannot hide behind a green aggregate.
 */
export const REQUIRED_CHECKS = [
  "CI",
  "Analyze (javascript-typescript)",
  "Typecheck",
  "Lint",
  "Dependency Audit",
  "Build",
];

/**
 * Paths Nightshift may never auto-merge.
 *
 * Migrations change production data irreversibly; workflows, CODEOWNERS, the
 * factory and Nightshift scripts are the machinery that governs the loop, and a
 * machine editing its own constitution is unauditable. These route to a human.
 */
export const HARD_BLOCK_PATTERNS: RegExp[] = [
  /^prisma\/migrations\//,
  /^\.github\/workflows\//,
  /^\.github\/CODEOWNERS$/,
  /^AGENTS\.md$/,
  /^scripts\/factory\//,
  /^scripts\/nightshift\//,
  /^docs\/factory\//,
];

function checkVerdict(checks: Check[], name: string): string | null {
  const check = checks.find((c) => c.name === name);
  if (!check) return `${name} never ran`;
  if (check.conclusion === null) return `${name} has not completed`;
  if (check.conclusion !== "success") return `${name} is ${check.conclusion}`;
  return null;
}

/**
 * Decide whether a Change may be merged by the loop.
 *
 * Reports *every* failing guard, not just the first: the audit line is worth
 * more when it says everything that was wrong.
 */
export function decideMerge(facts: MergeFacts, policy: MergePolicy = DEFAULT_POLICY): Verdict {
  const reasons: string[] = [];

  // 1. Only the loop's own machine-authored Changes. A human's Change always
  //    gets a human, no matter how green.
  if (!policy.allowedAuthors.includes(facts.author)) {
    reasons.push(`author ${facts.author} is not a loop author — a human's Change always gets a human`);
  }

  // 2. Target is main, never a feature branch.
  if (facts.baseRefName !== "main") {
    reasons.push(`base is ${facts.baseRefName}, not main`);
  }

  // 3. A draft is a human saying "not yet".
  if (facts.isDraft) {
    reasons.push("Change is a draft");
  }

  // 4. GitHub must have computed mergeability, and it must be MERGEABLE.
  if (facts.mergeable !== "MERGEABLE") {
    reasons.push(`mergeable is ${facts.mergeable}`);
  }

  // 5. Level with base (#1256): a green run on a stale base proves nothing
  //    about the base it will land on.
  if (facts.commitsBehindBase !== 0) {
    reasons.push(`${facts.commitsBehindBase} commit(s) behind base`);
  }

  // 6. Labels are the queue state. Unready or parked Changes do not land.
  if (!facts.labels.includes("factory:review")) {
    reasons.push("Change is not labelled factory:review");
  }
  if (facts.labels.includes("factory:blocked")) {
    reasons.push("Change is labelled factory:blocked");
  }

  // 7. Every gate present and green.
  for (const name of REQUIRED_CHECKS) {
    const problem = checkVerdict(facts.checks, name);
    if (problem) reasons.push(problem);
  }

  // 8. The green run must be on the SHA we would actually merge. A push after
  //    the checks settled makes the green run describe code that is gone.
  if (facts.headSha !== facts.checksSha) {
    reasons.push(`head ${facts.headSha.slice(0, 10)} is not the SHA CI ran on (${facts.checksSha.slice(0, 10)})`);
  }

  // 9. No open objection.
  if (facts.reviewThreadsUnresolved > 0) {
    reasons.push(`${facts.reviewThreadsUnresolved} unresolved review thread(s)`);
  }

  // 10. An independent approval, never the author's own.
  const independent = facts.approvals.filter((a) => !policy.allowedAuthors.includes(a));
  const trusted = independent.filter((a) => policy.requiredApprovers.includes(a));
  if (trusted.length === 0) {
    reasons.push("no approval from an independent required approver");
  }

  // 11. Reviewable size.
  if (facts.changedLines > policy.maxLines) {
    reasons.push(`${facts.changedLines} changed lines exceeds the ${policy.maxLines} cap`);
  }
  if (facts.changedFiles > policy.maxFiles) {
    reasons.push(`${facts.changedFiles} changed files exceeds the ${policy.maxFiles} cap`);
  }

  // 12. The coverage ratchet only moves up (Core Principle 5).
  if (facts.coverageThresholdsLowered) {
    reasons.push("a coverage threshold was lowered");
  }
  if (facts.coverageDelta < 0) {
    reasons.push(`coverage dropped by ${Math.abs(facts.coverageDelta).toFixed(2)}%`);
  }

  // 13. Mutation integrity (Core Principle 6).
  if (facts.mutationDelta < 0) {
    reasons.push(`mutation score dropped by ${Math.abs(facts.mutationDelta).toFixed(2)}`);
  }

  // 14. Unrecoverable or constitution-editing paths.
  const blocked = facts.touchedPaths.filter((p) => HARD_BLOCK_PATTERNS.some((re) => re.test(p)));
  if (blocked.length > 0) {
    reasons.push(`touches hard-block path(s): ${blocked.join(", ")}`);
  }

  return { eligible: reasons.length === 0, reasons };
}

/** One-line audit summary, safe to append to the ledger. */
export function explain(facts: MergeFacts, verdict: Verdict): string {
  const head = `#${facts.number} (${facts.headRefName}) — ${verdict.eligible ? "eligible" : "not eligible"}`;
  return verdict.eligible ? head : `${head}: ${verdict.reasons.join("; ")}`;
}
