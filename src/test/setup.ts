import fs from "fs";
import path from "path";

const PRISMA_DIR = path.resolve(__dirname, "../../prisma");
const TEST_DB_BASE = path.join(PRISMA_DIR, "test.db");

/**
 * Resolve a per-worker test DB path. Each vitest worker (thread) gets its
 * own SQLite file so writes from one worker don't block another. The base
 * DB (`prisma/test.db`) is created in `globalSetup.ts` with the full
 * schema applied; we copy it here.
 *
 * Note: Prisma resolves SQLite paths relative to the schema file's
 * directory (`prisma/`), so `file:./test-worker-N.db` lands at
 * `prisma/test-worker-N.db`.
 */
function resolveWorkerDbPath(): string {
  const workerId = process.env.VITEST_POOL_ID ?? "0";
  return path.join(PRISMA_DIR, `test-worker-${workerId}.db`);
}

const TEST_DB_PATH = resolveWorkerDbPath();
const MARKER = `${TEST_DB_PATH}.initialized`;

// Only copy the base DB once per worker (the first test file that runs in
// this worker initializes the DB; subsequent files in the same worker
// reuse the same file — tests already use beforeEach deleteMany for
// inter-test isolation).
if (!fs.existsSync(MARKER)) {
  fs.copyFileSync(TEST_DB_BASE, TEST_DB_PATH);
  for (const suffix of ["-wal", "-shm"]) {
    const f = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch {
        // best effort
      }
    }
  }
  fs.writeFileSync(MARKER, new Date().toISOString());
}

process.env.DATABASE_URL = `file:./${path.basename(TEST_DB_PATH)}`;
process.env.NODE_ENV = "test";

// Trusted OAuth client for integration tests
if (!process.env.TRUSTED_OAUTH_CLIENT_ID) {
  process.env.TRUSTED_OAUTH_CLIENT_ID = "test-trusted-client";
}
if (!process.env.TRUSTED_OAUTH_CLIENT_SECRET) {
  process.env.TRUSTED_OAUTH_CLIENT_SECRET = "test-trusted-secret";
}
if (!process.env.TRUSTED_OAUTH_REDIRECT_URIS) {
  process.env.TRUSTED_OAUTH_REDIRECT_URIS = "https://oauth.usebruno.com/callback";
}

// jsdom helpers (no-op in node environment)
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

  // Mock __APP_VERSION__ used by ResponsiveLayout
  (globalThis as any).__APP_VERSION__ = "0.0.0-test";
}
