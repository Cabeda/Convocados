/**
 * Pick the next Issue the Fixer should work.
 *
 * The queue lives on GitHub and is read on every run: an Issue is queued when
 * an Explorer labelled it `factory:explored`, and it leaves the queue when it is
 * Blocked, promoted to the human queue, already has an open Change, or carries a
 * live Claim. Oldest first, so the backlog drains in the order it was filed.
 *
 * This is a module, not a workflow step, because the ordering rules decide which
 * Issue a machine spends an hour on. A regex typo inside a workflow ships green.
 */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QUEUED = "factory:explored";
export const BLOCKED = "factory:blocked";
export const HUMAN_QUEUE = "ready-for-agent";
/** The Claim comment, exactly as `janitor.md` and the Factory write it. */
export const CLAIM = "factory: claiming";
/** A Claim is a lease: a run that died must not strand its Issue forever. */
export const CLAIM_TTL_MS = 2 * 60 * 60 * 1000;

export interface IssueSummary {
  number: number;
  createdAt: string;
  labels: Array<{ name: string }>;
  comments: Array<{ body: string; createdAt: string }>;
}

function hasLabel(issue: IssueSummary, label: string): boolean {
  return issue.labels.some((l) => l.name === label);
}

function claimIsLive(issue: IssueSummary, now: number): boolean {
  const last = issue.comments
    .filter((c) => c.body.includes(CLAIM))
    .reduce((newest, c) => Math.max(newest, Date.parse(c.createdAt)), 0);
  return last > 0 && now - last < CLAIM_TTL_MS;
}

/** `factory/<issue>-<slug>` is the only branch the delivery step will push. */
export function hasOpenChange(issue: IssueSummary, headRefs: string[]): boolean {
  return headRefs.some((ref) => ref.startsWith(`factory/${issue.number}-`));
}

export function isQueued(issue: IssueSummary, headRefs: string[], now: number): boolean {
  return (
    hasLabel(issue, QUEUED) &&
    !hasLabel(issue, BLOCKED) &&
    !hasLabel(issue, HUMAN_QUEUE) &&
    !hasOpenChange(issue, headRefs) &&
    !claimIsLive(issue, now)
  );
}

export function pickNext(
  issues: IssueSummary[],
  headRefs: string[],
  now: number,
): IssueSummary | null {
  const next = issues
    .filter((issue) => isQueued(issue, headRefs, now))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number)[0];
  return next ?? null;
}

function gh<T>(args: string[]): T {
  return JSON.parse(
    execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  ) as T;
}

function main(): number {
  const repo = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";
  const issues = gh<IssueSummary[]>([
    "issue", "list", "--repo", repo, "--state", "open", "--label", QUEUED,
    "--limit", "200", "--json", "number,createdAt,labels,comments",
  ]);
  const changes = gh<Array<{ headRefName: string }>>([
    "pr", "list", "--repo", repo, "--state", "open", "--limit", "200", "--json", "headRefName",
  ]);

  const next = pickNext(issues, changes.map((p) => p.headRefName), Date.now());
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `issue=${next?.number ?? ""}\n`);
  } else {
    console.log(next?.number ?? "");
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
