import fs from "fs";
import path from "path";

const PRISMA_DIR = path.resolve(__dirname, "../../prisma");
const TEST_DB_BASE = path.join(PRISMA_DIR, "test.db");

// Scope the per-worker DB by process id as well as pool id: Vitest runs test
// workers in separate processes, and `VITEST_POOL_ID` is only unique within a
// process. Without the pid, two project processes that both use pool 1 would
// share `test-worker-1.db` and corrupt each other's writes.
function resolveWorkerDbPath(): string {
  const workerId = process.env.VITEST_POOL_ID ?? "0";
  return path.join(PRISMA_DIR, `test-worker-${process.pid}-${workerId}.db`);
}

const TEST_DB_PATH = resolveWorkerDbPath();

// Always start from the schema-only base. Vitest can reuse a pid across runs,
// so reusing a leftover DB file (the old marker-file shortcut) risked carrying
// test data from a previous run into a new one. The copy is ~1 MB and runs in
// a fresh process per test file, so there is nothing to cache.
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  try {
    fs.unlinkSync(`${TEST_DB_PATH}${suffix}`);
  } catch {
    // best effort — file may not exist
  }
}
fs.copyFileSync(TEST_DB_BASE, TEST_DB_PATH);

process.env.DATABASE_URL = `file:./prisma/${path.basename(TEST_DB_PATH)}`;
process.env.NODE_ENV = "test";

if (!process.env.TRUSTED_OAUTH_CLIENT_ID) {
  process.env.TRUSTED_OAUTH_CLIENT_ID = "test-trusted-client";
}
if (!process.env.TRUSTED_OAUTH_CLIENT_SECRET) {
  process.env.TRUSTED_OAUTH_CLIENT_SECRET = "test-trusted-secret";
}
if (!process.env.TRUSTED_OAUTH_REDIRECT_URIS) {
  process.env.TRUSTED_OAUTH_REDIRECT_URIS = "https://oauth.usebruno.com/callback";
}

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  (globalThis as any).__APP_VERSION__ = "0.0.0-test";
}
