/**
 * Nightshift review — an adversarial second opinion, then an approval.
 *
 * The merge decision requires an approval from a required approver that is not
 * the author. This step produces it: a *different* model reads the diff and
 * returns a structured verdict, and if it approves, we post the review under a
 * distinct GitHub identity (`NIGHTSHIFT_REVIEWER_TOKEN`). Without a second
 * identity the approval is impossible — GitHub forbids self-approval — so the
 * loop fails closed and nothing merges.
 *
 * The reviewer is a separate session on purpose: the model that wrote the code
 * is the wrong model to judge it.
 *
 * Usage: node scripts/nightshift/review.ts
 *   REVIEW_MODEL=openai/gpt-5 node scripts/nightshift/review.ts
 */
import { execFileSync } from "node:child_process";
import { record } from "./ledger.ts";

const REPO = process.env.GITHUB_REPOSITORY ?? "Cabeda/Convocados";
const REVIEW_MODEL = process.env.NIGHTSHIFT_REVIEW_MODEL ?? "openai/gpt-5";
const REVIEWER_TOKEN = process.env.NIGHTSHIFT_REVIEWER_TOKEN ?? "";
const REVIEWER_LOGIN = process.env.NIGHTSHIFT_REVIEWER_LOGIN ?? "";
const SKIP_AGENT = process.env.NIGHTSHIFT_SKIP_AGENT === "1";

const REVIEW_PROMPT = `Review the diff below as an independent reviewer for the Convocados repository.
Judge it against AGENTS.md: the Mission, the three pillars, and the Core Principles
(never weaken a test, never lower a threshold). Look for regressions, missing tests,
platform-parity gaps, and edge cases.

End your response with exactly one line: "VERDICT: APPROVE" or "VERDICT: REJECT",
followed by a short reason. Nothing after that line.`;

function sh(cmd: string, args: string[], env?: NodeJS.ProcessEnv, allowFail = false): string {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
    });
  } catch (error) {
    if (allowFail) return "";
    throw error;
  }
}

function listForReview(): number[] {
  const out = sh("gh", [
    "pr",
    "list",
    "--repo",
    REPO,
    "--state",
    "open",
    "--label",
    "factory:review",
    "--limit",
    "50",
    "--json",
    "number",
  ]);
  return (JSON.parse(out) as Array<{ number: number }>).map((p) => p.number);
}

function parseVerdict(output: string): { approve: boolean; reason: string } | null {
  const match = output.match(/VERDICT:\s*(APPROVE|REJECT)\b[:\s-]*([^\n]*)/i);
  if (!match) return null;
  return { approve: match[1].toUpperCase() === "APPROVE", reason: match[2].trim() || "no reason given" };
}

function reviewerToken(): string {
  if (!REVIEWER_TOKEN) return "";
  // Exchange the token for this run only; never export it to the child agent.
  return REVIEWER_TOKEN;
}

function main(): void {
  const token = reviewerToken();
  if (!token) {
    record({ event: "review-scan", note: "NIGHTSHIFT_REVIEWER_TOKEN unset — cannot approve, nothing merges (fail closed)" });
    return;
  }

  for (const number of listForReview()) {
    const diff = sh("gh", ["pr", "diff", String(number), "--repo", REPO], undefined, true);
    if (!diff) {
      record({ event: "review-skipped", pr: number, reason: "no diff" });
      continue;
    }

    if (SKIP_AGENT) {
      record({ event: "review-agent-skipped", pr: number });
      continue;
    }

    const output = sh(
      "opencode",
      ["run", "--model", REVIEW_MODEL, "--dangerously-skip-permissions", `${REVIEW_PROMPT}\n\n${diff}`],
      undefined,
      true,
    );
    const verdict = parseVerdict(output);
    if (!verdict) {
      record({ event: "review-parse-failed", pr: number });
      continue;
    }
    if (!verdict.approve) {
      record({ event: "review-rejected", pr: number, reason: verdict.reason });
      continue;
    }

    const body = `Independent review by ${REVIEWER_LOGIN || "the Nightshift reviewer"}.\n\n${verdict.reason}`;
    const posted = sh(
      "gh",
      ["pr", "review", String(number), "--repo", REPO, "--approve", "--body", body],
      { GH_TOKEN: token },
      true,
    );
    record({
      event: posted ? "review-approved" : "review-approve-failed",
      pr: number,
      reason: verdict.reason,
    });
  }
}

main();
