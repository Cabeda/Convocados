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
      numberOfRuns: 1,
      settings: {
        preset: "desktop",
        maxWaitForLoad: 45000,
        throttlingMethod: "simulate",
      },
    },
    assert: {
      assertions: {
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["warn", { minScore: 0.9 }],
        // Performance is unreliable on CI runners — warn only
        "categories:performance": ["warn", { minScore: 0.5 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
