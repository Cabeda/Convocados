#!/usr/bin/env node
/**
 * Fail a PR whose body names no issue to close, so the logic the `PR Links
 * Issue` CI job enforces is a testable module rather than an inline workflow
 * snippet (a regex typo inside a workflow ships green — see the review on #1354).
 *
 * GitHub closes an issue only when the PR body carries a closing keyword
 * ("Closes #123", "Fixes #45", "Resolved: #7"). Without one the issue lingers
 * open after the fix ships, and the next agent reads solved work as live
 * (#1114 closed by hand 20h late, #1199 11 days late).
 *
 * The `no-issue` label exempts a PR that genuinely closes nothing.
 *
 * CLI: reads PR_BODY and PR_LABELS (comma-separated) from the environment, as
 * the CI job does. It also accepts the body as a file argument, plus a
 * `--no-issue` flag, so the same decision can be reached *before* the PR
 * exists — `node scripts/check-pr-closing-keyword.mjs body.md`. Checking after
 * `gh pr create` always costs a second trip.
 */

import { readFileSync } from "node:fs";

/** GitHub's closing keywords followed by an issue reference. */
export const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#\d+\b/i;

/** The escape hatch: a PR that legitimately closes no issue. */
export const EXEMPT_LABEL = "no-issue";

export function hasClosingKeyword(body) {
  return CLOSING_KEYWORD.test(body ?? "");
}

export function isExempt(labels) {
  return (labels ?? []).includes(EXEMPT_LABEL);
}

/**
 * @returns {{ ok: boolean, reason: "exempt" | "keyword" | "missing" }}
 */
export function evaluate({ body, labels }) {
  if (isExempt(labels)) return { ok: true, reason: "exempt" };
  if (hasClosingKeyword(body)) return { ok: true, reason: "keyword" };
  return { ok: false, reason: "missing" };
}

/**
 * Where the body and labels come from. The CI job supplies both through the
 * environment; the command line takes the body as a file argument and
 * `--no-issue` as the exemption, so the two paths reach the same verdict.
 */
export function resolveInput({ argv, env }) {
  const file = argv.find((arg) => !arg.startsWith("--"));
  const body = file ? readFileSync(file, "utf8") : (env.PR_BODY ?? "");
  const fromEnv = (env.PR_LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const labels = argv.includes("--no-issue") ? [...fromEnv, EXEMPT_LABEL] : fromEnv;
  return { body, labels };
}

function main() {
  const { body, labels } = resolveInput({
    argv: process.argv.slice(2),
    env: process.env,
  });

  const result = evaluate({ body, labels });
  if (result.ok) {
    console.log(`ok (${result.reason})`);
    return;
  }
  console.error(
    "PR body has no closing keyword (e.g. `Closes #123`). Add one so the linked " +
      "issue closes on merge, or apply the `no-issue` label if this PR closes no issue.",
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
