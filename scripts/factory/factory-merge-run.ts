/**
 * Merge the factory Changes that satisfy every predicate.
 *
 * All judgement lives in `automerge-eligibility.ts`; this file gathers facts and
 * merges. An LLM asked "may I merge this?" gives the same answer twice about
 * half the time, and merging deploys — so the decision is a tested list.
 *
 * Usage:
 *   node scripts/factory/factory-merge-run.ts             # merge what is eligible
 *   DRY_RUN=true node scripts/factory/factory-merge-run.ts # report only
 */
import { execFileSync } from "node:child_process";
import {
  BEHIND_BASE,
  type Check,
  decideFactoryMerge,
  type FactoryFacts,
  explain,
  type Verdict,
  reviewEntries,
  signedVerifier,
} from "./automerge-eligibility.ts";

const REPO = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";
const DRY_RUN = process.env.DRY_RUN === "true";
/** The App key the Reviewer's job signs with and the Fixer's job never sees. */
const APP_KEY = process.env.FACTORY_APP_KEY ?? "";

/** Fail closed: no key means no signature can be verified, so nothing merges. */
const verify = signedVerifier(APP_KEY);

interface RawPr {
  number: number;
  author: { login: string } | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isDraft: boolean;
  mergeable: string;
  labels: Array<{ name: string }>;
}

interface RawDetail {
  files: Array<{ path: string }>;
  comments: Array<{ body: string; createdAt?: string; author?: { login?: string } | null }>;
  reviews: Array<{ body: string; submittedAt?: string; author?: { login?: string } | null }>;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function ghJson<T>(args: string[]): T {
  const out = gh(args);
  if (!out.trim()) throw new Error(`gh ${args.join(" ")} returned nothing`);
  return JSON.parse(out) as T;
}

/**
 * Commits on `base` that `head` does not have. Fail closed: a green run on a
 * stale base proved nothing about the base it will land on (#1256).
 */
function commitsBehind(base: string, head: string): number {
  const out = gh(["api", `repos/${REPO}/compare/${base}...${head}`, "--jq", ".behind_by"]);
  const n = Number.parseInt(out.trim(), 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

function checksFor(pr: RawPr): Check[] {
  const { check_runs } = ghJson<{ check_runs: Array<{ name: string; conclusion: string | null }> }>([
    "api",
    `repos/${REPO}/commits/${pr.headRefOid}/check-runs?per_page=100`,
  ]);
  return check_runs.map((c) => ({ name: c.name, conclusion: c.conclusion }));
}

function factsFor(pr: RawPr): { facts: FactoryFacts; verdict: Verdict } {
  const detail = ghJson<RawDetail>([
    "pr", "view", String(pr.number), "--repo", REPO,
    "--json", "files,comments,reviews",
  ]);

  const facts: FactoryFacts = {
    number: pr.number,
    author: pr.author?.login ?? "",
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable as FactoryFacts["mergeable"],
    commitsBehindBase: commitsBehind(pr.baseRefName, pr.headRefName),
    labels: pr.labels.map((l) => l.name),
    checks: checksFor(pr),
    files: detail.files.map((f) => f.path),
    // One normaliser for both surfaces. It reads `submittedAt` from reviews —
    // `createdAt` does not exist there, and mapping it produced NaN ordering.
    reviews: reviewEntries(detail),
    verify,
  };

  return { facts, verdict: decideFactoryMerge(facts) };
}

function main(): number {
  const open = ghJson<RawPr[]>([
    "pr", "list", "--repo", REPO, "--state", "open", "--limit", "50",
    "--json", "number,author,baseRefName,headRefName,headRefOid,isDraft,mergeable,labels",
  ]);
  const factory = open.filter((pr) => pr.headRefName.startsWith("factory/"));

  if (factory.length === 0) {
    console.log("No open factory Changes.");
    return 0;
  }

  let merged = 0;
  for (const pr of factory) {
    const { facts, verdict } = factsFor(pr);
    console.log(explain(facts, verdict));
    if (!verdict.eligible) {
      // A stale base is the one block the machine can clear itself. Updating the
      // branch re-runs CI; the next tick merges on evidence about the new base.
      if (verdict.reasons.every((r) => r.includes(BEHIND_BASE))) {
        try {
          gh(["pr", "update-branch", String(pr.number), "--repo", REPO]);
          console.log(`updated #${pr.number} onto ${pr.baseRefName}`);
        } catch (error) {
          console.log(`could not update #${pr.number}: ${error}`);
        }
      }
      continue;
    }

    if (DRY_RUN) {
      console.log(`would merge #${pr.number}`);
      continue;
    }

    // `--match-head-commit` is the race guard: the decision was made about this
    // commit, and a push between the read and the merge would land untested code.
    // One rejected merge must not abort the batch — a head-of-line stall is how
    // a later eligible Change never gets merged.
    try {
      gh([
        "pr", "merge", String(pr.number), "--repo", REPO, "--merge",
        "--match-head-commit", pr.headRefOid,
        "--subject", `${pr.headRefName}: merge (two-way door, green, approved)`,
      ]);
      console.log(`merged #${pr.number}`);
      merged += 1;
    } catch (error) {
      console.log(`merge of #${pr.number} was rejected: ${error}`);
    }
  }

  console.log(merged === 0 ? "Nothing to merge." : `Merged ${merged}.`);
  return 0;
}

process.exitCode = main();
