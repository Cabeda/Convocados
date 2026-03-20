import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    exclude: ["node_modules", "dist", "e2e"],
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
    // Default: node environment for API/unit tests
    environment: "node",
    globalSetup: ["./src/test/globalSetup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Component tests use jsdom via inline config comment
    environmentMatchGlobs: [
      ["src/test/components/**", "jsdom"],
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
        "src/lib/calendarToken.server.ts",
        "src/pages/api/auth/**",
        "src/pages/api/openapi.json.ts",
        "src/pages/api/admin/**",
        "src/pages/api/cron/**",
        "src/pages/api/me/api-keys.ts",
        "src/pages/api/me/calendar-token.ts",
        "src/pages/api/events/[id]/calendar.ics.ts",
        "src/pages/api/events/[id]/stream.ts",
        "src/pages/api/users/[id]/calendar.ics.ts",
        "src/test/**",
      ],
      thresholds: { lines: 89, functions: 90, branches: 84, statements: 89 },
    },
  },
});
