/** @type {import('@lhci/cli').Config} */
export default {
  ci: {
    collect: {
      url: [
        "http://localhost:3000/",
        "http://localhost:3000/public",
        "http://localhost:3000/auth/signin",
      ],
      numberOfRuns: 1,
      settings: {
        preset: "desktop",
        // CI runners are slow — extend timeouts
        maxWaitForLoad: 45000,
        throttlingMethod: "simulate",
      },
    },
    assert: {
      assertions: {
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.9 }],
        // Performance is unreliable on CI runners — warn only
        "categories:performance": ["warn", { minScore: 0.5 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
