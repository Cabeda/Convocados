import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../../test.db");
process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
process.env.NODE_ENV = "test";

// ── Trusted OAuth client for integration tests ────────────────────────────
// Set before auth.server.ts is imported so buildTrustedClients() picks them up
if (!process.env.TRUSTED_OAUTH_CLIENT_ID) {
  process.env.TRUSTED_OAUTH_CLIENT_ID = "test-trusted-client";
}
if (!process.env.TRUSTED_OAUTH_CLIENT_SECRET) {
  process.env.TRUSTED_OAUTH_CLIENT_SECRET = "test-trusted-secret";
}
if (!process.env.TRUSTED_OAUTH_REDIRECT_URIS) {
  process.env.TRUSTED_OAUTH_REDIRECT_URIS = "https://oauth.usebruno.com/callback";
}

// ── jsdom helpers (no-op in node environment) ──────────────────────────────
if (typeof window !== "undefined") {
  // MUI requires matchMedia
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
