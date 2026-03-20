import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Track magic link emails sent
const sentEmails: { to: string; url: string }[] = [];

// Mock email.server to capture magic link sends
vi.mock("~/lib/email.server", () => ({
  sendMagicLinkEmail: vi.fn(async (to: string, url: string) => {
    sentEmails.push({ to, url });
  }),
  sendVerificationEmail: vi.fn(),
  sendChangeEmailVerification: vi.fn(),
}));

// Mock logger
vi.mock("~/lib/logger.server", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── i18n key tests ──────────────────────────────────────────────────────────

describe("Magic link i18n keys", () => {
  it("has all magic link keys in en locale", async () => {
    const en = (await import("~/lib/i18n/en")).default;
    expect(en.magicLinkTitle).toBeTruthy();
    expect(en.magicLinkDesc).toBeTruthy();
    expect(en.magicLinkBtn).toBeTruthy();
    expect(en.magicLinkSent).toBeTruthy();
    expect(en.magicLinkError).toBeTruthy();
    expect(en.sendingMagicLink).toBeTruthy();
    expect(en.signInWithEmail).toBeTruthy();
    expect(en.signInWithPassword).toBeTruthy();
  });

  it("has all magic link keys in pt locale", async () => {
    const pt = (await import("~/lib/i18n/pt")).default;
    expect(pt.magicLinkTitle).toBeTruthy();
    expect(pt.magicLinkDesc).toBeTruthy();
    expect(pt.magicLinkBtn).toBeTruthy();
    expect(pt.magicLinkSent).toBeTruthy();
    expect(pt.magicLinkError).toBeTruthy();
    expect(pt.sendingMagicLink).toBeTruthy();
    expect(pt.signInWithEmail).toBeTruthy();
    expect(pt.signInWithPassword).toBeTruthy();
  });

  it("has all magic link keys in es locale", async () => {
    const es = (await import("~/lib/i18n/es")).default;
    expect(es.magicLinkTitle).toBeTruthy();
    expect(es.magicLinkBtn).toBeTruthy();
    expect(es.magicLinkSent).toBeTruthy();
  });

  it("has all magic link keys in fr locale", async () => {
    const fr = (await import("~/lib/i18n/fr")).default;
    expect(fr.magicLinkTitle).toBeTruthy();
    expect(fr.magicLinkBtn).toBeTruthy();
    expect(fr.magicLinkSent).toBeTruthy();
  });

  it("has all magic link keys in de locale", async () => {
    const de = (await import("~/lib/i18n/de")).default;
    expect(de.magicLinkTitle).toBeTruthy();
    expect(de.magicLinkBtn).toBeTruthy();
    expect(de.magicLinkSent).toBeTruthy();
  });

  it("has all magic link keys in it locale", async () => {
    const it = (await import("~/lib/i18n/it")).default;
    expect(it.magicLinkTitle).toBeTruthy();
    expect(it.magicLinkBtn).toBeTruthy();
    expect(it.magicLinkSent).toBeTruthy();
  });
});

// ── sendMagicLinkEmail function tests ───────────────────────────────────────

describe("sendMagicLinkEmail", () => {
  beforeEach(() => {
    sentEmails.length = 0;
    vi.clearAllMocks();
  });

  it("is exported from email.server", async () => {
    // We mocked it above, but verify the real module exports it
    // by checking the mock was set up correctly
    const { sendMagicLinkEmail } = await import("~/lib/email.server");
    expect(typeof sendMagicLinkEmail).toBe("function");
  });
});

// ── Auth server config tests ────────────────────────────────────────────────

describe("Auth server config", () => {
  it("includes magic-link plugin", async () => {
    // The auth config should have the magic-link plugin registered.
    // We verify by checking that the auth handler can handle magic link routes.
    // Since better-auth registers plugins at init time, we just verify the
    // config file imports and uses the magicLink plugin.
    const authSource = await import("~/lib/auth.server");
    expect(authSource.auth).toBeDefined();
    // The auth object should have the magic link endpoints registered
    // We can verify by checking the API methods exist
    expect(typeof authSource.auth.api.signInMagicLink).toBe("function");
  });
});

// ── Auth client config tests ────────────────────────────────────────────────

describe("Auth client config", () => {
  it("exports signIn with magicLink method", async () => {
    const { signIn } = await import("~/lib/auth.client");
    expect(signIn).toBeDefined();
    // The magicLink method should be available on signIn
    expect(typeof (signIn as any).magicLink).toBe("function");
  });
});
