import { defineConfig, devices } from "@playwright/test";
import { createECDH } from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
const BASE_URL = `http://localhost:${PORT}`;
const DB_PATH = path.resolve(__dirname, "e2e-test.db");

// VAPID keys for the push e2e server. Prefer the caller's keys; otherwise mint a
// fresh pair for this run so no key material ever lives in the repo. A hardcoded
// private key trips GitHub secret scanning and is a permanent rotation liability.
function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}

const vapid =
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
    : generateVapidKeys();
const VAPID_PUBLIC_KEY = vapid.publicKey;
const VAPID_PRIVATE_KEY = vapid.privateKey;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
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
      use: {
        ...devices["Desktop Chrome"],
        // Allow overriding the browser path for environments where
        // Playwright can't download its own Chromium (e.g. low-disk
        // sandboxes, air-gapped runners). Set PLAYWRIGHT_CHROMIUM_EXECUTABLE
        // to a system chromium path.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  webServer: {
    command: `DATABASE_URL=file:${DB_PATH} BETTER_AUTH_SECRET=e2e-test-secret-that-is-long-enough BETTER_AUTH_URL=${BASE_URL} VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY} VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY} HOST=0.0.0.0 PORT=${PORT} node dist/server/entry.mjs`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
