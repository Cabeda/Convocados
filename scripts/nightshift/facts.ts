/**
 * Nightshift fact-building — pure mapping from raw GitHub JSON to `MergeFacts`.
 *
 * All the parsing lives here so `merge.ts` is thin and the fiddly bits (which
 * checks ran, on which SHA, who approved) are unit-tested without a network.
 * Fails closed: anything we cannot determine becomes a value the merge decision
 * will reject.
 */
import type { Check, MergeFacts } from "./merge-eligibility.ts";

export interface RawPr {
  number: number;
  author: string | null;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  mergeable: string;
  labels: string[];
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface RawReview {
  author: string | null;
  /** APPROVED · CHANGES_REQUESTED · COMMENTED · DISMISSED · PENDING */
  state: string;
}

export interface RawCheckRun {
  name: string;
  conclusion: string | null;
  head_sha: string;
}

export interface RawFile {
  path: string;
}

export interface CoverageFacts {
  /** post-change minus pre-change coverage, in percentage points. */
  delta: number;
  /** True when a threshold in vitest.config.ts was lowered. */
  thresholdsLowered: boolean;
}

export interface MutationFacts {
  /** post-change minus pre-change mutation score, in points. */
  delta: number;
}

export interface FactInput {
  pr: RawPr;
  checks: RawCheckRun[];
  files: RawFile[];
  reviews: RawReview[];
  reviewThreadsUnresolved: number;
  commitsBehindBase: number;
  coverage: CoverageFacts;
  mutation: MutationFacts;
}

/** Logins whose latest review state is APPROVED. */
export function approvalsOf(reviews: RawReview[]): string[] {
  const approved = new Set<string>();
  const state = new Map<string, string>();
  for (const r of reviews) {
    const who = r.author;
    if (!who) continue;
    state.set(who, r.state);
  }
  for (const [who, s] of state) {
    if (s === "APPROVED") approved.add(who);
  }
  return [...approved];
}

/**
 * The SHA every check ran against, or `""` when they disagree.
 *
 * Disagreement means the check set spans more than one head (a push mid-run).
 * An empty string can never equal a real head, so the decision fails closed.
 */
export function checksShaOf(checks: RawCheckRun[]): string {
  const shas = new Set(checks.map((c) => c.head_sha));
  return shas.size === 1 ? [...shas][0] : "";
}

export function buildMergeFacts(input: FactInput): MergeFacts {
  const { pr, checks, files, reviews, coverage, mutation } = input;
  const checkList: Check[] = checks.map((c) => ({ name: c.name, conclusion: c.conclusion }));

  return {
    number: pr.number,
    author: pr.author ?? "unknown",
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable as MergeFacts["mergeable"],
    commitsBehindBase: input.commitsBehindBase,
    labels: pr.labels,
    checks: checkList,
    headSha: pr.headRefOid,
    checksSha: checksShaOf(checks),
    changedLines: pr.additions + pr.deletions,
    changedFiles: pr.changedFiles,
    reviewThreadsUnresolved: input.reviewThreadsUnresolved,
    approvals: approvalsOf(reviews),
    coverageDelta: coverage.delta,
    mutationDelta: mutation.delta,
    coverageThresholdsLowered: coverage.thresholdsLowered,
    touchedPaths: files.map((f) => f.path),
  };
}
