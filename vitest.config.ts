import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    globalSetup: ["./src/test/globalSetup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/lib/**", "src/pages/api/**"],
      exclude: ["src/lib/db.server.ts", "src/lib/useT.ts", "src/test/**"],
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
    },
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
});
