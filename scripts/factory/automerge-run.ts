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
import { decideAutomerge, explain, REQUIRED_CHECKS, type Check, type PullRequestFacts } from "./automerge-eligibility.ts";

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

/**
 * Run `gh`, reporting whether it worked.
 *
 * Deliberately not a bare string getter. Swallowing the exit status let the
 * "Auto-merge armed" comment post even when arming failed — the audit record
 * claiming something the run had not achieved, which is the exact dishonesty
 * the deterministic-script argument exists to rule out.
 */
function gh(args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch {
    return { ok: false, out: "" };
  }
}

function ghJson<T>(args: string[]): T {
  const { ok, out } = gh(args);
  if (!ok || !out.trim()) throw new Error(`gh ${args.join(" ")} failed or returned nothing`);
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
  const { ok, out } = gh([
    "api",
    `repos/${REPO}/compare/${base}...${head}`,
    "--jq",
    ".behind_by",
  ]);
  if (!ok) return Number.MAX_SAFE_INTEGER;
  const n = Number.parseInt(out.trim(), 10);
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

async function arm(pr: PullRequestFacts): Promise<boolean> {
  // Arm first, and only claim it if the arm actually succeeded.
  const armed = gh(["pr", "merge", String(pr.number), "--squash", "--auto", "--delete-branch"]);

  const body = armed.ok
    ? [
        "Auto-merge armed by the Delivery Factory.",
        "",
        "Machine-authored dependency bump. Every required gate is green on this exact",
        "head, and the branch is level with `main`. GitHub fires the merge itself when",
        "the required checks settle.",
        "",
        "This factory can arm auto-merge but holds no merge permission, so it cannot",
        "force this merge. Branch protection still decides.",
        "",
        "**Reversal is two steps, not one.** Unsetting `FACTORY_AUTOMERGE` stops future",
        "runs but does NOT cancel what is already armed — GitHub fires armed auto-merge",
        "independently of any repository variable. To stop this one, cancel auto-merge on",
        "this PR as well. Add `factory:blocked` to park it.",
        "",
        "<details><summary>Conditions checked</summary>",
        "",
        "- author is `dependabot[bot]`",
        "- base is `main`, not a draft, no conflicts, mergeability computed",
        "- not behind `main` (a green run on a stale base proves nothing about it)",
        `- ${REQUIRED_CHECKS.map((c) => `\`${c}\``).join(", ")} all \`success\` on this head`,
        "- no `factory:blocked` label",
        "",
        "</details>",
      ].join("\n")
    : [
        "**The factory tried to arm auto-merge here and failed.** No auto-merge is",
        "queued on this PR. Leaving it for a human.",
        "",
        "Usual cause: repository auto-merge is disabled, or the token lacks",
        "`pull-requests: write`. Nothing about this PR's green gates is in question —",
        "the gates are green, the *arming* is what failed.",
      ].join("\n");

  const commented = gh(["pr", "comment", String(pr.number), "--body", body]);
  if (!commented.ok) console.warn(`  #${pr.number}: could not post the audit comment`);
  return armed.ok;
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
    // Count only arms that actually happened. A failed arm is reported, not
    // tallied, so the summary cannot overstate what the run did.
    if (await arm(facts)) armed += 1;
  }

  console.log(DRY_RUN ? "Dry run: nothing armed." : `Armed auto-merge on ${armed} PR(s).`);
}

await main();