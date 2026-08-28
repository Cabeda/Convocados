/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.config.ts",
  },
  mutate: [
    "src/lib/idempotency.ts",
    "src/lib/rsvp-notifications.server.ts",
    "src/lib/paymentNudgeEscalation.server.ts",
    "src/lib/paymentMethods.ts",
    "src/lib/trustedClient.server.ts",
    "src/pages/api/events/[[]id[]]/players.ts",
  ],
  reporters: ["progress", "clear-text", "html"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  // ── Dead-code gate ──────────────────────────────────────────────────────────
  // Mutation score is the share of mutants killed by tests. A SURVIVING mutant
  // is code whose behaviour doesn't matter to any test = dead or untested code.
  // The `break` threshold is the gate: when the score drops below it the run
  // fails, blocking the push. Measured 2026-08-05 with players.ts included:
  // overall 92.75%, players.ts 91.73% (0 survived, 89 no-coverage = the
  // unreachable tryBalancedSwap swap body). Set with headroom so a single
  // dead branch trips the gate.
  thresholds: {
    high: 92,
    low: 85,
    break: 80,
  },
  // better-sqlite3 is a native addon; running multiple Stryker test runners
  // concurrently can SIGSEGV and leave Vitest workers holding moved databases.
  // Keep the mutation run serialized and let CI bound the overall job.
  concurrency: 1,
  timeoutMS: 30000,
};
