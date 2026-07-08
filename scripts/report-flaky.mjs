#!/usr/bin/env node
/**
 * Flakiness detection: parse vitest JSON output and report tests that
 * required retries or had suspiciously long durations (>10s).
 *
 * In CI: outputs GitHub Actions annotations.
 * Locally: prints to stdout.
 *
 * Usage: node scripts/report-flaky.mjs [test-results.json]
 */
import { readFileSync, existsSync } from "node:fs";

const file = process.argv[2] || "test-results.json";
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

if (!existsSync(file)) {
  // No results file — tests may not have produced JSON output
  if (isCI) console.log("::notice::No test-results.json found, skipping flakiness check");
  else console.log("No test results file found at", file);
  process.exit(0);
}

const raw = JSON.parse(readFileSync(file, "utf-8"));
const SLOW_THRESHOLD_MS = 10_000;

const flaky = [];
const slow = [];

function walkSuites(suites, filePath) {
  for (const suite of suites || []) {
    for (const test of suite.tests || []) {
      // Vitest marks retried tests with result.retryCount > 0
      if (test.result?.retryCount > 0) {
        flaky.push({ name: test.name, file: filePath, retries: test.result.retryCount });
      }
      if (test.result?.duration > SLOW_THRESHOLD_MS) {
        slow.push({ name: test.name, file: filePath, duration: test.result.duration });
      }
    }
    // Recurse into nested suites
    if (suite.suites) walkSuites(suite.suites, filePath);
  }
}

// Vitest JSON format: { testResults: [{ file, suites, tests }] }
for (const fileResult of raw.testResults || []) {
  const filePath = fileResult.name || fileResult.file || "unknown";
  // Tests at file level
  for (const test of fileResult.assertionResults || []) {
    if (test.retryCount > 0) {
      flaky.push({ name: test.fullName || test.title, file: filePath, retries: test.retryCount });
    }
    if (test.duration > SLOW_THRESHOLD_MS) {
      slow.push({ name: test.fullName || test.title, file: filePath, duration: test.duration });
    }
  }
  // Suites
  walkSuites(fileResult.suites, filePath);
}

// Output
if (flaky.length === 0 && slow.length === 0) {
  console.log("✅ No flaky or slow tests detected.");
  process.exit(0);
}

if (flaky.length > 0) {
  console.log(`\n⚠️  ${flaky.length} flaky test(s) detected (required retries):\n`);
  for (const t of flaky) {
    const msg = `Flaky: "${t.name}" in ${t.file} (retried ${t.retries}x)`;
    if (isCI) console.log(`::warning file=${t.file}::${msg}`);
    else console.log(`  ⚠️  ${msg}`);
  }
}

if (slow.length > 0) {
  console.log(`\n🐢 ${slow.length} slow test(s) (>${SLOW_THRESHOLD_MS / 1000}s):\n`);
  for (const t of slow) {
    const secs = (t.duration / 1000).toFixed(1);
    const msg = `Slow: "${t.name}" in ${t.file} (${secs}s)`;
    if (isCI) console.log(`::warning file=${t.file}::${msg}`);
    else console.log(`  🐢 ${msg}`);
  }
}

// Don't fail the build — just warn
process.exit(0);
