import { createHmac, timingSafeEqual } from "node:crypto";

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
  /** ISO timestamp; several runs can share a name after a re-run. */
  completedAt?: string | null;
}

/** The run that decides a name: latest `completedAt`, then last in the list. */
export function latestCheck(checks: Check[], name: string): Check | undefined {
  const matching = checks.filter((c) => c.name === name);
  if (matching.length === 0) return undefined;
  return matching.reduce((newest, c) => {
    const a = Date.parse(newest.completedAt ?? "");
    const b = Date.parse(c.completedAt ?? "");
    return Number.isNaN(b) || (!Number.isNaN(a) && b < a) ? newest : c;
  });
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
  // Both `main` rulesets require it (13717171 and 20842995, verified against
  // repos/…/rules/branches/main). Without it the decision can say "eligible"
  // and `gh pr merge` is then rejected by branch protection.
  "PR Links Issue",
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
export const REVIEWED_MARKER = /<!-- factory:reviewed:([0-9a-f]{7,40}):([0-9a-f]{64}) -->/;
/** Legacy two-part marker, accepted only so an old comment cannot crash a run. */
const UNSIGNED_MARKER = /<!-- factory:reviewed:([0-9a-f]{7,40}) -->/;
export const VERDICT_MARKER = /<!-- factory:verdict:(approve|refuse) -->/;

/** A path whose merge outlives a revert. Every entry is a real blast radius. */
export const ONE_WAY_PATHS: Array<{ match: RegExp; why: string }> = [
  { match: /^prisma\/migrations\//, why: "a database migration" },
  { match: /^prisma\/schema\.prisma$/, why: "a schema change" },
  // Any server module whose name says auth, token, session, cron, scheduler or
  // push. The first list named only `auth*.server.ts` and missed
  // `googleToken.server.ts`, `calendarToken.server.ts`, `cronAuth.server.ts`
  // and `scheduler.server.ts` — all verified two-way by the Reviewer.
  { match: /^src\/lib\/[^/]*(auth|token|oauth|session|cron|schedul|push|vapid|apikey|jwks|secret|credential|admin)[^/]*\.server\.ts$/i, why: "auth, token or scheduler handling" },
  { match: /^src\/pages\/api\/auth\//, why: "an auth route" },
  { match: /^src\/pages\/api\/(cron|internal|admin)\//, why: "a privileged route" },
  { match: /^src\/pages\/api\/push\//, why: "push credentials" },
  { match: /^src\/pages\/api\/.*push[^/]*\.ts$/, why: "push credentials" },
  { match: /^src\/pages\/api\/me\/credentials\//, why: "account credentials" },
  { match: /^src\/lib\/merge[^/]*\.server\.ts$/, why: "account merging" },
  { match: /^src\/pages\/api\/(me\/calendar-token|oauth-callback|invite\/)/, why: "a token route" },
  // The scheduler is its own service, with its own lockfile and image; the
  // root `scripts/*schedul*` anchor did not cover it.
  { match: /^scheduler\//, why: "the scheduler service" },
  { match: /^src\/lib\/oauth/, why: "OAuth and token handling" },
  { match: /^\.github\//, why: "the workflows that run the factory" },
  // The decision and the instructions are the most one-way files here: a Change
  // that weakens them is green, approved, and then executes on the next tick.
  { match: /^scripts\/factory\//, why: "the factory's own decision code" },
  { match: /^\.opencode\/(agents|skills)\//, why: "the roles' instructions" },
  { match: /^AGENTS\.md$/, why: "the constitution" },
  { match: /^(package\.json|pnpm-lock\.yaml)$/, why: "dependencies" },
  { match: /^android-app\/(gradle|libs\.versions\.toml|.*\.gradle\.kts?$)/, why: "the Android build" },
  { match: /^(fly\.toml|Dockerfile|deploy\/|litestream\.ya?ml$)/, why: "deploy configuration" },
  { match: /^scripts\/[^/]*(schedul|backfill|cron)/i, why: "the scheduler" },
  // The checks the merge itself trusts. Editing one is editing the measurement.
  { match: /^scripts\/(ci-gate|check-pr-closing-keyword|route-coverage)/, why: "a required check" },
  { match: /^(vitest|stryker|playwright)\.config\./, why: "the measurement itself" },
];

/** The factory App, under every spelling GitHub has returned for it. */
export const FACTORY_IDENTITY = /^(app\/)?convocarados-factory(\[bot\])?$/;

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
  signature: string | null;
  verdict: "approve" | "refuse" | null;
  /** The entry's body, so a caller can read the findings marker. */
  body: string;
}

/**
 * A signature covers the head **and** the verdict. Covering only the head let a
 * refusal's signature be replayed with an `approve` marker — same head, same
 * bytes, opposite decision.
 */
export type SignatureCheck = (head: string, verdict: string, signature: string) => boolean;

/** The exact bytes both the Reviewer's job and the Merge job sign. */
export function signedMessage(head: string, verdict: string): string {
  return `${head}|${verdict}`;
}

/** One verifier for the gate and both pickers: HMAC over head|verdict. */
export function signedVerifier(key: string): SignatureCheck {
  return (head, verdict, signature) => {
    if (!key) return false;
    const expected = createHmac("sha256", key).update(signedMessage(head, verdict)).digest("hex");
    if (signature.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  };
}

export interface ReviewEntry {
  author: string;
  body: string;
  createdAt: string;
}

/** The last of a marker that may be quoted earlier in the same body. */
function lastMatch(re: RegExp, body: string): string | null {
  const all = [...body.matchAll(new RegExp(re.source, "g"))];
  return all.at(-1)?.[1] ?? null;
}

/**
 * The newest review by the factory App that names a head.
 *
 * Author-scoped because the marker was unauthenticated: any GitHub user could
 * comment `verdict:approve` and the gate would merge. Sorted by time because
 * comments and formal reviews arrive in two lists and concatenating them puts a
 * newer comment *before* an older review. Last marker wins because the prompt
 * hands the agent both literals and a review may quote the one it rejected.
 */
export function latestReview(
  entries: ReviewEntry[],
  verify?: SignatureCheck,
): ReviewRecord | null {
  const ordered = [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const entry = ordered[i];
    if (!FACTORY_IDENTITY.test(entry.author ?? "")) continue;
    const signed = [...(entry.body ?? "").matchAll(new RegExp(REVIEWED_MARKER.source, "g"))].at(-1);
    const unsigned = UNSIGNED_MARKER.test(entry.body ?? "");
    if (!signed && !unsigned) continue;
    const head = signed?.[1] ?? UNSIGNED_MARKER.exec(entry.body ?? "")?.[1] ?? "";
    const signature = signed?.[2] ?? null;
    const verdict = lastMatch(VERDICT_MARKER, entry.body ?? "") as ReviewRecord["verdict"];

    // When a verifier is supplied, an unsigned marker — or one whose signature
    // does not cover this head **and** this verdict — is not a review at all.
    if (verify && (!signature || !verdict || !verify(head, verdict, signature))) continue;
    return { head, signature, verdict: verdict ?? null, body: entry.body ?? "" };
  }
  return null;
}

export interface FactoryFacts extends PullRequestFacts {
  files: string[];
  reviews: ReviewEntry[];
  headRefOid: string;
  /** Required for a merge: without it an unsigned marker is ignored. */
  verify?: SignatureCheck;
}

/** The substring the merge runner looks for when a stale base is the only block. */
export const BEHIND_BASE = "behind base";

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
    reasons.push(`is ${pr.commitsBehindBase} commit(s) ${BEHIND_BASE} — its CI proved nothing about the base it lands on`);
  }

  for (const required of REQUIRED_CHECKS) {
    const check = latestCheck(pr.checks, required);
    if (!check) reasons.push(`required check "${required}" never ran`);
    else if (check.conclusion === null) reasons.push(`required check "${required}" has not completed`);
    else if (check.conclusion !== "success") reasons.push(`required check "${required}" concluded ${check.conclusion}`);
  }

  const door = isTwoWayDoor(pr.files);
  reasons.push(...door.reasons);

  if (!pr.verify) {
    reasons.push("no signature check is configured — an unsigned marker is not a review");
  }
  const review = latestReview(pr.reviews, pr.verify);
  if (!review) {
    reasons.push("no review has named its head");
  } else if (!pr.headRefOid.startsWith(review.head)) {
    reasons.push(`the newest review named ${review.head}, not the current head`);
  } else if (review.verdict !== "approve") {
    reasons.push(`the Reviewer's verdict on this head is ${review.verdict ?? "missing"}`);
  }

  return { eligible: reasons.length === 0, reasons };
}

/** Normalise `gh pr view --json comments,reviews` into one time-ordered list. */
export function reviewEntries(raw: {
  comments?: Array<{ body?: string; createdAt?: string; author?: { login?: string } | null }>;
  reviews?: Array<{ body?: string; submittedAt?: string; createdAt?: string; author?: { login?: string } | null }>;
}): ReviewEntry[] {
  const entries: ReviewEntry[] = [
    ...(raw.comments ?? []).map((c) => ({
      author: c.author?.login ?? "",
      body: c.body ?? "",
      createdAt: c.createdAt ?? "",
    })),
    ...(raw.reviews ?? []).map((r) => ({
      author: r.author?.login ?? "",
      body: r.body ?? "",
      createdAt: r.submittedAt ?? r.createdAt ?? "",
    })),
  ];
  return entries.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/**
 * True when the factory App reviewed this exact head — approved or refused.
 *
 * With a verifier, only a signed review counts: an unsigned marker lets the
 * Fixer (same App identity) suppress a review it does not want.
 */
export function reviewedAt(
  entries: ReviewEntry[],
  headOid: string,
  verify?: SignatureCheck,
): boolean {
  const review = latestReview(entries, verify);
  return review !== null && headOid.startsWith(review.head);
}
