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
 * Named explicitly so a rename surfaces as a failure rather than silently
 * dropping a gate from the required set.
 */
export const REQUIRED_CHECKS = [
  "CI",
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