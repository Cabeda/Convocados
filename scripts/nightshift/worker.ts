/**
 * Nightshift worker — one Issue, in one isolated worktree, to one Change.
 *
 * This is the local analogue of the Factory agent job. It does not merge; the
 * merge pass does that. It ends when a Change is open, or non-zero when it could
 * not get there, leaving the evidence in the ledger and the gate log.
 *
 * Usage: node scripts/nightshift/worker.ts <issue-number>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { branchForIssue, type IssueFacts } from "./plan.ts";
import { parseCoverageSummary, parseThresholds, thresholdsLowered } from "./coverage.ts";
import { record } from "./ledger.ts";

const REPO = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";
const ROOT = process.cwd();
const WT_ROOT = join(ROOT, ".nightshift/worktrees");
const BASE_COVERAGE_FILE = join(ROOT, ".nightshift/base-coverage.txt");
const COVERAGE_FILE = join(ROOT, ".nightshift/coverage-delta.json");
const SKIP_AGENT = process.env.NIGHTSHIFT_SKIP_AGENT === "1";
const IMPLEMENT_MODEL = process.env.NIGHTSHIFT_MODEL ?? "anthropic/claude-sonnet-4-5";

function sh(cmd: string, args: string[], cwd = ROOT, allowFail = false): string {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFail) return "";
    throw error;
  }
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(sh("gh", args)) as T;
}

function issueFacts(number: number): IssueFacts {
  const i = ghJson<{ number: number; title: string; createdAt: string; labels: Array<{ name: string }> }>([
    "issue",
    "view",
    String(number),
    "--repo",
    REPO,
    "--json",
    "number,title,createdAt,labels",
  ]);
  return { number: i.number, title: i.title, createdAt: i.createdAt, labels: i.labels.map((l) => l.name) };
}

/** Claim: a lease the next run reads, so two workers do not pick the same Issue. */
function claim(number: number): void {
  sh("gh", ["issue", "comment", String(number), "--repo", REPO, "--body", "nightshift: claiming"]);
}

function prepareWorktree(branch: string): string {
  const path = join(WT_ROOT, branch.replace(/\//g, "-"));
  mkdirSync(WT_ROOT, { recursive: true });
  sh("git", ["fetch", "origin", "main", "--quiet"], ROOT);
  if (existsSync(path)) {
    sh("git", ["worktree", "remove", "--force", path], ROOT, true);
  }
  sh("git", ["worktree", "add", "-b", branch, path, "origin/main"], ROOT);
  if (process.env.NIGHTSHIFT_BOOTSTRAP === "1") {
    sh("sh", ["scripts/worktree-bootstrap.sh"], path, true);
  }
  return path;
}

const PROMPT = `You are implementing Issue #{n} in this repository as Nightshift, a local
autonomous worker.

Read AGENTS.md and docs/factory/CONTEXT.md first. Follow the Factory procedure for
\`factory/<issue>-<slug>\`: TDD (failing test first), then the change, then run
\`bash scripts/factory/gate.sh\`. Do not merge, do not label, do not touch main. Report what
you did and the gate result.`;

function runAgent(worktree: string, number: number): void {
  if (SKIP_AGENT) {
    record({ event: "worker-agent-skipped", issue: number });
    return;
  }
  const prompt = PROMPT.replace("{n}", String(number));
  sh(
    "opencode",
    ["run", "--agent", "nightshift", "--model", IMPLEMENT_MODEL, "--dangerously-skip-permissions", prompt],
    worktree,
  );
}

function measureCoverage(worktree: string, log: string): void {
  const head = readFileSync(join(worktree, "vitest.config.ts"), "utf8");
  const baseText = sh("git", ["show", "origin/main:vitest.config.ts"], ROOT, true) || head;
  const lowered = thresholdsLowered(parseThresholds(baseText), parseThresholds(head));
  const covered = parseCoverageSummary(log);
  const base = existsSync(BASE_COVERAGE_FILE) ? Number.parseFloat(readFileSync(BASE_COVERAGE_FILE, "utf8")) : null;
  const delta = covered !== null && base !== null && !Number.isNaN(base) ? covered - base : 0;
  writeFileSync(COVERAGE_FILE, `${JSON.stringify({ delta, thresholdsLowered: lowered }, null, 2)}\n`);
  record({ event: "coverage", covered, base, delta, thresholdsLowered: lowered });
}

function main(): void {
  const number = Number(process.argv[2]);
  if (!Number.isInteger(number) || number <= 0) {
    process.stderr.write("usage: node scripts/nightshift/worker.ts <issue-number>\n");
    process.exit(2);
  }

  const issue = issueFacts(number);
  const branch = branchForIssue(issue);
  record({ event: "worker-start", issue: number, branch });

  claim(number);
  const worktree = prepareWorktree(branch);

  runAgent(worktree, number);

  const gate = sh("bash", ["scripts/factory/gate.sh"], worktree, true);
  const gateLog = join(ROOT, `.nightshift/gate-${number}.log`);
  writeFileSync(gateLog, gate);
  measureCoverage(worktree, gate);

  // A non-empty push is the signal the gate passed; gate.sh exits non-zero on
  // failure and `sh` would have returned "" for stdout. Push only when we have a
  // diff against origin/main.
  const diff = sh("git", ["diff", "--stat", "origin/main...HEAD"], worktree, true);
  if (!diff) {
    record({ event: "worker-blocked", issue: number, reason: "no diff" });
    process.exit(1);
  }

  sh("git", ["push", "-u", "origin", branch], worktree, true);
  const prUrl = sh(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      REPO,
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `factory: ${issue.title}`,
      "--body",
      `Closes #${number}\n\nOpened by Nightshift. Gate log: see the run's ledger.`,
    ],
    worktree,
    true,
  );

  if (!prUrl) {
    record({ event: "worker-blocked", issue: number, reason: "pr create failed" });
    process.exit(1);
  }
  record({ event: "pr-open", issue: number, branch, url: prUrl });
}

main();
