/**
 * Arm GitHub auto-merge on dependency bumps that satisfy every predicate.
 *
 * All judgement lives in `automerge-eligibility.ts`; this file only gathers
 * facts and acts. That split is deliberate — the decision is testable without a
 * network, and the I/O is thin enough to read in one sitting.
 *
 * Usage:
 *   node scripts/factory/automerge-run.ts              # arm what is eligible
 *   DRY_RUN=true node scripts/factory/automerge-run.ts  # report only
 */
import { execFileSync } from "node:child_process";
import { decideAutomerge, explain, type Check, type PullRequestFacts } from "./automerge-eligibility.ts";

const REPO = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";
const DRY_RUN = process.env.DRY_RUN === "true";

interface RawPr {
  number: number;
  author: { login: string } | null;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  mergeable: string;
  labels: Array<{ name: string }>;
}

function gh(args: string[]): string {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

function ghJson<T>(args: string[]): T {
  const out = gh(args);
  if (!out.trim()) throw new Error(`gh ${args.join(" ")} returned nothing`);
  return JSON.parse(out) as T;
}

/**
 * Commits on `base` that `head` does not have.
 *
 * This is the #1256 guard. That PR's lockfile predated the sharp override; its
 * own CI was green because the branch never had the override. Merging it put
 * Dependency Audit back to red on main. A green run on a stale base proves
 * nothing about the base it will land on.
 *
 * If this cannot be determined we return MAX_SAFE_INTEGER, i.e. fail closed.
 */
function commitsBehind(base: string, head: string): number {
  const out = gh([
    "api",
    `repos/${REPO}/compare/${base}...${head}`,
    "--jq",
    ".behind_by",
  ]).trim();
  const n = Number.parseInt(out, 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

async function collectFacts(pr: RawPr): Promise<PullRequestFacts> {
  const runs = ghJson<{ check_runs: Array<{ name: string; conclusion: string | null }> }>([
    "api",
    `repos/${REPO}/commits/${pr.headRefName}/check-runs?per_page=100`,
  ]);

  const checks: Check[] = runs.check_runs.map((c) => ({ name: c.name, conclusion: c.conclusion }));

  return {
    number: pr.number,
    author: pr.author?.login ?? "unknown",
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable as PullRequestFacts["mergeable"],
    commitsBehindBase: commitsBehind(pr.baseRefName, pr.headRefName),
    labels: pr.labels.map((l) => l.name),
    checks,
  };
}

async function arm(pr: PullRequestFacts): Promise<void> {
  const body = [
    "Auto-merge armed by the Delivery Factory.",
    "",
    "Machine-authored dependency bump. Every required gate is green on this exact",
    "head, and the branch is level with `main`. GitHub fires the merge itself when",
    "the required checks settle — the factory cannot force it, and branch",
    "protection still applies.",
    "",
    "Reversal: unset the `FACTORY_AUTOMERGE` repository variable and cancel auto-merge",
    "on this PR. Add `factory:blocked` to park it.",
    "",
    "<details><summary>Conditions checked</summary>",
    "",
    "- author is `dependabot[bot]`",
    "- base is `main`, not a draft, no conflicts, mergeability computed",
    "- not behind `main` (a green run on a stale base proves nothing about it)",
    "- `CI`, `Typecheck`, `Lint`, `Dependency Audit`, `Build` all `success`",
    "- no `factory:blocked` label",
    "",
    "</details>",
  ].join("\n");

  gh(["pr", "merge", String(pr.number), "--squash", "--auto", "--delete-branch"]);
  gh(["pr", "comment", String(pr.number), "--body", body]);
}

async function main(): Promise<void> {
  const prs = ghJson<RawPr[]>([
    "pr",
    "list",
    "--repo",
    REPO,
    "--state",
    "open",
    "--limit",
    "50",
    "--json",
    "number,author,baseRefName,headRefName,isDraft,mergeable,labels",
  ]);

  if (prs.length === 0) {
    console.log("No open PRs.");
    return;
  }

  let armed = 0;
  for (const raw of prs) {
    const facts = await collectFacts(raw);
    const verdict = decideAutomerge(facts);
    console.log(explain(facts, verdict));

    if (!verdict.eligible) continue;
    if (DRY_RUN) {
      console.log(`  dry run: would arm auto-merge on #${facts.number}`);
      continue;
    }
    await arm(facts);
    armed += 1;
  }

  console.log(DRY_RUN ? "Dry run: nothing armed." : `Armed auto-merge on ${armed} PR(s).`);
}

await main();