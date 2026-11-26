/**
 * Pick the factory Change the Fixer should answer next.
 *
 * Same reason as `next-review.ts`: the agent action refuses a run whose actor
 * is the App, and every machine push makes the App the actor. A scheduled run's
 * actor is the human who last touched the workflow, so both machine roles are
 * schedule-driven.
 *
 * A Change needs a round when the *latest* review names the current head and
 * carries the findings marker. A push changes the head, which hands it back to
 * the Reviewer; a round that changes nothing leaves the marker in place, so the
 * Attempt budget — not this predicate — is what stops that loop.
 */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { latestReview, type ReviewEntry, reviewEntries } from "./automerge-eligibility.ts";

export const ROUND_BUDGET = 3;
const ATTEMPT = "factory: attempt <review>";

export interface FixCandidate {
  number: number;
  headRefName: string;
  headRefOid: string;
  /** Comments and formal reviews, already normalised by `reviewEntries`. */
  entries: ReviewEntry[];
  /** Required checks that did not pass. A red one is always worth a round. */
  failingChecks: string[];
}

export function needsFix(pr: FixCandidate): boolean {
  if (!pr.headRefName.startsWith("factory/")) return false;

  const entries = pr.entries ?? [];
  const rounds = entries.filter((c) => (c.body ?? "").includes(ATTEMPT)).length;
  if (rounds >= ROUND_BUDGET) return false;

  if ((pr.failingChecks ?? []).length > 0) return true;

  // `latestReview` is author-scoped and time-ordered, so a forged or older
  // marker cannot start a round against the wrong head.
  const latest = latestReview(entries);
  if (!latest || !pr.headRefOid.startsWith(latest.head)) return false;
  return latest.verdict !== "approve";
}

export function pickFix(candidates: FixCandidate[]): FixCandidate | null {
  return candidates.filter(needsFix).sort((a, b) => a.number - b.number)[0] ?? null;
}

function gh<T>(args: string[]): T {
  return JSON.parse(
    execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  ) as T;
}

function main(): number {
  const repo = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";
  const raw = gh<
    Array<{ number: number; headRefName: string; headRefOid: string; comments: unknown[]; reviews: unknown[] }>
  >([
    "pr", "list", "--repo", repo, "--state", "open", "--limit", "100",
    "--json", "number,headRefName,headRefOid,comments,reviews,statusCheckRollup",
  ]);

  const prs: FixCandidate[] = raw.map((pr) => ({
    number: pr.number,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    entries: reviewEntries(pr as never),
    failingChecks: ((pr as { statusCheckRollup?: Array<{ name?: string; context?: string; conclusion?: string; state?: string }> }).statusCheckRollup ?? [])
      .filter((c) => {
        const state = (c.conclusion ?? c.state ?? "").toUpperCase();
        return state !== "" && state !== "SUCCESS" && state !== "NEUTRAL" && state !== "SKIPPED";
      })
      .map((c) => c.name ?? c.context ?? "check"),
  }));

  const next = pickFix(prs);
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `pr=${next?.number ?? ""}\n`);
  } else {
    console.log(next?.number ?? "");
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
