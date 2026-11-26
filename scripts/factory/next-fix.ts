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

export const ROUND_BUDGET = 3;
const FINDINGS = "<!-- factory:findings -->";
const REVIEWED = /<!-- factory:reviewed:([0-9a-f]{7,40}) -->/;
const ATTEMPT = "factory: attempt <review>";

export interface FixCandidate {
  number: number;
  headRefName: string;
  headRefOid: string;
  comments: Array<{ body: string }>;
}

export function needsFix(pr: FixCandidate): boolean {
  if (!pr.headRefName.startsWith("factory/")) return false;

  const comments = pr.comments ?? [];
  const rounds = comments.filter((c) => (c.body ?? "").includes(ATTEMPT)).length;
  if (rounds >= ROUND_BUDGET) return false;

  // The API returns comments oldest-first; the last review is the current word.
  const latest = comments
    .filter((c) => REVIEWED.test(c.body ?? ""))
    .at(-1);
  if (!latest) return false;

  const reviewedHead = REVIEWED.exec(latest.body)?.[1];
  return reviewedHead === pr.headRefOid && latest.body.includes(FINDINGS);
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
  const prs = gh<FixCandidate[]>([
    "pr", "list", "--repo", repo, "--state", "open", "--limit", "100",
    "--json", "number,headRefName,headRefOid,comments",
  ]);

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
