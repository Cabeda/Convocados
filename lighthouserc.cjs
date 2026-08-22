/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      startServerCommand:
        "DATABASE_URL=file:./ci-test.db BETTER_AUTH_SECRET=ci-test-secret BETTER_AUTH_URL=http://localhost:3000 HOST=0.0.0.0 PORT=3000 node dist/server/entry.mjs",
      startServerReadyPattern: "Server listening on",
      startServerReadyTimeout: 30000,
      // Fast mode: LHCI_FAST=1 => 1 run × 1 URL for sub-60s CI.
      // Full mode (nightly/manual): 3 runs × 3 URLs for low flake.
      // Absolute max speed needs 1 URL; 1 run saves ~80s vs 3×3 (122s→~18s).
      url: process.env.LHCI_FAST
        ? ["http://localhost:3000/"]
        : [
            "http://localhost:3000/",
            "http://localhost:3000/public",
            "http://localhost:3000/auth/signin",
          ],
      numberOfRuns: process.env.LHCI_FAST ? 1 : 3,
      settings: {
        preset: "desktop",
        maxWaitForLoad: process.env.LHCI_FAST ? 30000 : 45000,
        // "simulate" throttling is deterministic (applied to a single trace)
        // rather than measuring real network/CPU, which is far less flaky in CI.
        throttlingMethod: "simulate",
        // Pin desktop throttling so the simulated environment is identical
        // across runs and machines.
        throttling: {
          cpuSlowdownMultiplier: 1,
          rttMs: 40,
          throughputKbps: 10 * 1024,
        },
        // Skip audits that are irrelevant here and add run-to-run noise.
        skipAudits: ["uses-http2", "canonical"],
      },
    },
    assert: {
      // Aggregate the 3 runs by median: the build only fails if the *median*
      // run misses the threshold, so a single flaky run can no longer fail CI.
      aggregationMethod: "median",
      assertions: {
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.9 }],
        // Performance is the noisiest category. Use the median of 3 runs and a
        // realistic threshold so genuine regressions still fail, but jitter does
        // not. (Tuned against locally-measured medians.)
        "categories:performance": ["error", { minScore: 0.75, aggregationMethod: "median" }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
