import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    exclude: ["node_modules", "dist", "e2e", "mobile"],
    environment: "node",
    env: {
      // Ensure CI is always set in test workers, regardless of how vitest
      // is invoked. The pre-push hook sets CI=1 before `npx vitest`, but
      // vitest's fork pool does not always propagate it to workers —
      // `describe.skipIf(!!process.env.CI)` then fails to skip the
      // oauth-trusted-client tests, which fail because the trusted client
      // is only initialized lazily on first request and the test DB
      // state isn't shared across forks in the way the local dev path
      // expects. Forcing CI here keeps the skip behavior consistent.
      CI: "1",
      ...(process.env.TRUSTED_OAUTH_CLIENT_ID
        ? { TRUSTED_OAUTH_CLIENT_ID: process.env.TRUSTED_OAUTH_CLIENT_ID }
        : {}),
      ...(process.env.TRUSTED_OAUTH_CLIENT_SECRET
        ? { TRUSTED_OAUTH_CLIENT_SECRET: process.env.TRUSTED_OAUTH_CLIENT_SECRET }
        : {}),
    },
    globalSetup: ["./src/test/globalSetup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    projects: [
      {
        resolve: {
          alias: {
            "~": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "node",
          include: ["src/test/**/*.test.ts"],
          exclude: ["src/test/components/**"],
          env: {
            CI: "1",
            ...(process.env.TRUSTED_OAUTH_CLIENT_ID
              ? { TRUSTED_OAUTH_CLIENT_ID: process.env.TRUSTED_OAUTH_CLIENT_ID }
              : {}),
            ...(process.env.TRUSTED_OAUTH_CLIENT_SECRET
              ? { TRUSTED_OAUTH_CLIENT_SECRET: process.env.TRUSTED_OAUTH_CLIENT_SECRET }
              : {}),
          },
        },
      },
      {
        resolve: {
          alias: {
            "~": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "jsdom",
          include: ["src/test/components/**/*.test.ts", "src/test/components/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./src/test/jsdom-setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/lib/**", "src/pages/api/**"],
      exclude: [
        "src/lib/db.server.ts",
        "src/lib/useT.ts",
        "src/lib/auth.client.ts",
        "src/lib/auth.server.ts",
        "src/lib/push.server.ts",
        "src/lib/notificationQueue.server.ts",
        "src/lib/calendarToken.server.ts",
        "src/pages/api/auth/**",
        "src/pages/api/oauth-callback.ts",
        "src/pages/api/openapi.json.ts",
        "src/pages/api/admin/**",
        "src/pages/api/cron/**",
        "src/pages/api/me/api-keys.ts",
        "src/pages/api/me/calendar-token.ts",
        "src/pages/api/events/[id]/calendar.ics.ts",
        "src/pages/api/watch/**",
        "src/pages/api/users/[id]/calendar.ics.ts",
        "src/test/**",
      ],
      thresholds: { lines: 94, functions: 94, branches: 83, statements: 94 },
    },
  },
});
