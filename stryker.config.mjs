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
  ],
  reporters: ["progress", "clear-text", "html"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  concurrency: 2,
  timeoutMS: 30000,
};
