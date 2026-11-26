/**
 * Pick the open Change the Reviewer should read next.
 *
 * A `pull_request` run cannot review a factory Change: the action asserts the
 * *actor's* repo permission, and a branch the App pushed has the App as actor,
 * whose collaborator permission is `none`. A scheduled run's actor is the human
 * who last touched the workflow, which is why this selection exists — the
 * reviewer reaches machine Changes from a schedule, not from their event.
 *
 * The marker is the reviewer's own receipt: it ends a review with
 * `<!-- factory:reviewed:<head sha> -->`, so a Change is pending until a review
 * names the exact commit it read. A push changes the sha and reopens it.
 */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ReviewEntry, reviewEntries, reviewedAt } from "./automerge-eligibility.ts";

export interface ReviewCandidate {
  number: number;
  headRefName: string;
  headRefOid: string;
  /** Comments and formal reviews, already normalised by `reviewEntries`. */
  entries: ReviewEntry[];
}

/**
 * Only a review by the factory App that names this exact head counts. Formal
 * reviews and issue comments both count — the Reviewer posts either way.
 */
export function needsReview(pr: ReviewCandidate): boolean {
  return !reviewedAt(pr.entries ?? [], pr.headRefOid);
}

export function pickReview(candidates: ReviewCandidate[]): ReviewCandidate | null {
  const next = candidates
    .filter((pr) => pr.headRefName.startsWith("factory/"))
    .filter(needsReview)
    .sort((a, b) => a.number - b.number)[0];
  return next ?? null;
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
    "--json", "number,headRefName,headRefOid,comments,reviews",
  ]);
  const prs: ReviewCandidate[] = raw.map((pr) => ({
    number: pr.number,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    entries: reviewEntries(pr as never),
  }));

  const next = pickReview(prs);
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
