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
 * CLI: reads PR_BODY and PR_LABELS (comma-separated) from the environment.
 */

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

function main() {
  const body = process.env.PR_BODY ?? "";
  const labels = (process.env.PR_LABELS ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

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
