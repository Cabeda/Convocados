/**
 * Nightshift selection — the thin I/O wrapper around `plan.ts`.
 *
 * Prints the workable Issue numbers, in order, one JSON array on stdout. All the
 * rules live in `plan.ts`; this file only asks GitHub and maps the shape.
 */
import { execFileSync } from "node:child_process";
import { planOrder, type IssueFacts, type OpenPrHead } from "./plan.ts";

const REPO = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";

function ghJson<T>(args: string[]): T {
  const out = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out) as T;
}

function listIssues(): IssueFacts[] {
  const raw = ghJson<Array<{ number: number; title: string; createdAt: string; labels: Array<{ name: string }> }>>([
    "issue",
    "list",
    "--repo",
    REPO,
    "--state",
    "open",
    "--label",
    "ready-for-agent",
    "--limit",
    "100",
    "--json",
    "number,title,createdAt,labels",
  ]);
  return raw.map((i) => ({
    number: i.number,
    title: i.title,
    createdAt: i.createdAt,
    labels: i.labels.map((l) => l.name),
  }));
}

function listOpenPrHeads(): OpenPrHead[] {
  const raw = ghJson<Array<{ headRefName: string }>>([
    "pr",
    "list",
    "--repo",
    REPO,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "headRefName",
  ]);
  return raw.map((p) => ({ headRefName: p.headRefName }));
}

try {
  const order = planOrder(listIssues(), listOpenPrHeads());
  process.stdout.write(`${JSON.stringify(order)}\n`);
} catch (error) {
  process.stderr.write(`[nightshift] select failed: ${String(error)}\n`);
  process.stdout.write("[]\n");
}
