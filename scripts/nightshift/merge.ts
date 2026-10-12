/**
 * Nightshift merge — gather facts, decide, merge serially, watch for regressions.
 *
 * This is the only place in Nightshift that lands a Change. It holds no
 * judgement of its own: every decision comes from `decideMerge()` in
 * `merge-eligibility.ts`. This file is thin I/O plus the two impulses a script
 * is allowed to have — a serial merge lock, and a post-merge canary that opens a
 * revert when main goes red.
 *
 * Usage:
 *   node scripts/nightshift/merge.ts            # merge every eligible Change
 *   DRY_RUN=1 node scripts/nightshift/merge.ts  # report only, merge nothing
 *   PR=42 node scripts/nightshift/merge.ts      # consider one PR
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { DEFAULT_POLICY, decideMerge, explain, type MergeFacts, type MergePolicy } from "./merge-eligibility.ts";
import {
  buildMergeFacts,
  type CoverageFacts,
  type MutationFacts,
  type RawCheckRun,
  type RawFile,
  type RawPr,
  type RawReview,
} from "./facts.ts";
import { record } from "./ledger.ts";

const REPO = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.NIGHTSHIFT_DRY_RUN === "1";
const AUTO_REVERT = process.env.NIGHTSHIFT_AUTO_REVERT === "1";
const LOCK = process.env.NIGHTSHIFT_MERGE_LOCK ?? ".nightshift/merge.lock";
const COVERAGE_FILE = process.env.NIGHTSHIFT_COVERAGE_FILE ?? ".nightshift/coverage-delta.json";

function gh(args: string[], allowFail = false): string {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFail) return "";
    throw error;
  }
}

function ghJson<T>(args: string[], allowFail = false): T {
  const out = gh(args, allowFail);
  if (!out) return [] as unknown as T;
  return JSON.parse(out) as T;
}

function policy(): MergePolicy {
  // No implicit author. Defaulting to the current gh login inverts guard 1 on
  // the documented local setup (your own token): every human Change you authored
  // becomes loop-eligible while the factory's are not. Authors are opt-in by
  // name; without them, only the DEFAULT_POLICY identities merge — fail closed.
  const authors = (process.env.NIGHTSHIFT_AUTHORS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const approvers = (process.env.NIGHTSHIFT_REVIEWERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    ...DEFAULT_POLICY,
    allowedAuthors: authors.length > 0 ? authors : DEFAULT_POLICY.allowedAuthors,
    requiredApprovers: approvers,
    maxLines: Number(process.env.NIGHTSHIFT_MAX_LINES ?? DEFAULT_POLICY.maxLines),
    maxFiles: Number(process.env.NIGHTSHIFT_MAX_FILES ?? DEFAULT_POLICY.maxFiles),
  };
}

/** Unresolved, non-outdated review threads. Fails closed (returns 1) on error. */
function unresolvedThreads(number: number): number {
  const query = `query($n:Int!){repository(owner:"${REPO.split("/")[0]}",name:"${REPO.split("/")[1]}"){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved isOutdated}}}}}`;
  const out = gh(["api", "graphql", "-f", `query=${query}`, "-F", `n=${number}`], true);
  if (!out) return 1;
  try {
    const threads = JSON.parse(out).data.repository.pullRequest.reviewThreads.nodes as Array<{
      isResolved: boolean;
      isOutdated: boolean;
    }>;
    return threads.filter((t) => !t.isResolved && !t.isOutdated).length;
  } catch {
    return 1;
  }
}

function commitsBehind(head: string): number {
  const out = gh(["api", `repos/${REPO}/compare/main...${head}`, "--jq", ".behind_by"], true);
  const n = Number.parseInt(out, 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

function readCoverage(): CoverageFacts {
  if (existsSync(COVERAGE_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(COVERAGE_FILE, "utf8")) as Partial<CoverageFacts>;
      return { delta: parsed.delta ?? 0, thresholdsLowered: parsed.thresholdsLowered ?? false };
    } catch {
      // fall through to the fail-closed default
    }
  }
  // Unknown coverage is not a proven-unchanged coverage: the delta guard passes
  // only because nothing measured it, so say so in the ledger instead of
  // implying a number was checked.
  record({ event: "coverage-report-missing", path: COVERAGE_FILE, note: "coverageDelta guard not measured" });
  return { delta: 0, thresholdsLowered: false };
}

interface PrView extends RawPr {
  reviews: RawReview[];
  files: RawFile[];
}

async function gather(number: number): Promise<MergeFacts> {
  const pr = ghJson<PrView>([
    "pr",
    "view",
    String(number),
    "--repo",
    REPO,
    "--json",
    "number,author,baseRefName,headRefName,isDraft,mergeable,labels,headRefOid,additions,deletions,changedFiles,reviews,files",
  ]);
  const raw = pr as unknown as {
    number: number;
    author: { login: string } | null;
    baseRefName: string;
    headRefName: string;
    isDraft: boolean;
    mergeable: string;
    labels: Array<{ name: string }>;
    headRefOid: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    reviews: RawReview[];
    files: Array<{ path: string }>;
  };

  const checks = ghJson<{ check_runs: RawCheckRun[] }>([
    "api",
    `repos/${REPO}/commits/${raw.headRefOid}/check-runs?per_page=100`,
  ]).check_runs;

  const mutation: MutationFacts = { delta: 0 };

  return buildMergeFacts({
    pr: {
      number: raw.number,
      author: raw.author?.login ?? null,
      baseRefName: raw.baseRefName,
      headRefName: raw.headRefName,
      isDraft: raw.isDraft,
      mergeable: raw.mergeable,
      labels: raw.labels.map((l) => l.name),
      headRefOid: raw.headRefOid,
      additions: raw.additions,
      deletions: raw.deletions,
      changedFiles: raw.changedFiles,
    },
    checks,
    files: raw.files.map((f) => ({ path: f.path })),
    reviews: raw.reviews ?? [],
    reviewThreadsUnresolved: unresolvedThreads(raw.number),
    commitsBehindBase: commitsBehind(raw.headRefName),
    coverage: readCoverage(),
    mutation,
  });
}

function acquireLock(): boolean {
  if (existsSync(LOCK)) {
    const age = Date.now() - statSync(LOCK).mtimeMs;
    if (age < 30 * 60 * 1000) return false;
    record({ event: "lock-stale", path: LOCK, ageMs: age });
  }
  writeFileSync(LOCK, String(process.pid));
  return true;
}

function releaseLock(): void {
  try {
    unlinkSync(LOCK);
  } catch {
    // already gone
  }
}

function latestMainConclusion(): string | null {
  const runs = ghJson<Array<{ conclusion: string | null; status: string; headSha: string }>>([
    "run",
    "list",
    "--repo",
    REPO,
    "--branch",
    "main",
    "--event",
    "push",
    "--limit",
    "1",
    "--json",
    "status,conclusion,headSha",
  ]);
  if (runs.length === 0) return null;
  return runs[0].status === "completed" ? runs[0].conclusion : null;
}

/** Best-effort revert of a bad merge: a new Change, never a force-push. */
function openRevert(prNumber: number): void {
  const sha = gh(["pr", "view", String(prNumber), "--repo", REPO, "--json", "mergeCommit", "--jq", ".mergeCommit.oid"], true);
  if (!sha) {
    record({ event: "revert-failed", pr: prNumber, reason: "no merge commit" });
    return;
  }
  const branch = `revert/nightshift-${prNumber}`;
  try {
    gh(["api", `repos/${REPO}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]);
    record({ event: "revert-opened", pr: prNumber, branch });
  } catch (error) {
    record({ event: "revert-failed", pr: prNumber, error: String(error) });
  }
}

async function main(): Promise<void> {
  const one = process.env.PR;
  const prs = ghJson<Array<{ number: number }>>(
    one
      ? ["pr", "view", one, "--repo", REPO, "--json", "number"]
      : ["pr", "list", "--repo", REPO, "--state", "open", "--label", "factory:review", "--limit", "50", "--json", "number"],
  );
  const numbers = Array.isArray(prs) ? prs.map((p) => p.number) : [Number(one)];

  if (numbers.length === 0) {
    record({ event: "merge-scan", note: "no factory:review Changes" });
    return;
  }

  const pol = policy();
  if (pol.requiredApprovers.length === 0) {
    record({ event: "merge-scan", note: "NIGHTSHIFT_REVIEWERS unset — nothing is eligible (fail closed)" });
  }

  for (const number of numbers) {
    let facts: MergeFacts;
    try {
      facts = await gather(number);
    } catch (error) {
      record({ event: "merge-gather-failed", pr: number, error: String(error) });
      continue;
    }

    const verdict = decideMerge(facts, pol);
    record({ event: "merge-decision", pr: number, eligible: verdict.eligible, reasons: verdict.reasons });

    if (!verdict.eligible) {
      process.stderr.write(`[nightshift] ${explain(facts, verdict)}\n`);
      continue;
    }
    if (DRY_RUN) {
      process.stderr.write(`[nightshift] dry run: would merge #${number}\n`);
      continue;
    }

    // Serial: one merge at a time, re-checked immediately before, so two Changes
    // cannot both be green against a base they would then race.
    if (!acquireLock()) {
      record({ event: "merge-skipped", pr: number, reason: "another merge in flight" });
      continue;
    }
    try {
      const fresh = await gather(number);
      const freshVerdict = decideMerge(fresh, pol);
      if (!freshVerdict.eligible) {
        record({ event: "merge-aborted", pr: number, reasons: freshVerdict.reasons });
        continue;
      }
      gh(["pr", "merge", String(number), "--repo", REPO, "--squash", "--delete-branch"]);
      record({ event: "merged", pr: number, sha: fresh.headSha });

      // Canary. Merging deploys; if main does not stay green, get a human's
      // Change ready rather than pretend it is fine.
      const conclusion = latestMainConclusion();
      record({ event: "canary", pr: number, main: conclusion });
      if (conclusion && conclusion !== "success" && AUTO_REVERT) {
        openRevert(number);
      }
    } catch (error) {
      record({ event: "merge-failed", pr: number, error: String(error) });
    } finally {
      releaseLock();
    }
  }
}

await main();
