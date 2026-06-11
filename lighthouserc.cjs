/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      startServerCommand:
        "DATABASE_URL=file:./ci-test.db BETTER_AUTH_SECRET=ci-test-secret BETTER_AUTH_URL=http://localhost:3000 HOST=0.0.0.0 PORT=3000 node dist/server/entry.mjs",
      startServerReadyPattern: "Server listening on",
      startServerReadyTimeout: 30000,
      url: [
        "http://localhost:3000/",
        "http://localhost:3000/public",
        "http://localhost:3000/auth/signin",
      ],
      // Run each URL 3 times so transient noise (CPU/network jitter on CI
      // runners) is averaged out instead of failing the build on a single
      // unlucky run. Assertions below aggregate across these runs.
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
        maxWaitForLoad: 45000,
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
