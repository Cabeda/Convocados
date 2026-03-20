import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;
const DB_PATH = path.resolve(__dirname, "e2e-test.db");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false, // SQLite doesn't handle parallel writes well
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "html" : "list",
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `DATABASE_URL=file:${DB_PATH} BETTER_AUTH_SECRET=e2e-test-secret-that-is-long-enough BETTER_AUTH_URL=${BASE_URL} HOST=0.0.0.0 PORT=${PORT} node dist/server/entry.mjs`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
