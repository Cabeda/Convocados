import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;
const DB_PATH = path.resolve(__dirname, "e2e-test.db");

// Test VAPID keys for web push e2e tests — use env vars or fall back to
// pre-generated test-only keys (these have no security value).
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "BJ34_OulE3hyvRFANs6bXb8t-8qpffj90-dwfy8V1DD9B44ER-bP181iyp3hXw1wlkaq-VbeLcy_IuQh7aPUYjs";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "CiPrdEcokfW8WIFvj1bptu0y6ybCtS3YlWlBCjvAF8M";

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
    command: `DATABASE_URL=file:${DB_PATH} BETTER_AUTH_SECRET=e2e-test-secret-that-is-long-enough BETTER_AUTH_URL=${BASE_URL} VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY} VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY} HOST=0.0.0.0 PORT=${PORT} node dist/server/entry.mjs`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
