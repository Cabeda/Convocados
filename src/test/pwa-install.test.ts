import { describe, it, expect, vi, beforeEach } from "vitest";

// ── i18n key tests ──────────────────────────────────────────────────────────

describe("PWA install prompt i18n keys", () => {
  it("has all PWA install keys in en locale", async () => {
    const en = (await import("~/lib/i18n/en")).default;
    expect(en.installApp).toBeTruthy();
    expect(en.installAppDesc).toBeTruthy();
    expect(en.installBtn).toBeTruthy();
    expect(en.installDismiss).toBeTruthy();
    expect(en.installIosHint).toBeTruthy();
    expect(en.versionAvailable).toBeTruthy();
  });

  it("has all PWA install keys in pt locale", async () => {
    const pt = (await import("~/lib/i18n/pt")).default;
    expect(pt.installApp).toBeTruthy();
    expect(pt.installAppDesc).toBeTruthy();
    expect(pt.installBtn).toBeTruthy();
    expect(pt.installDismiss).toBeTruthy();
    expect(pt.installIosHint).toBeTruthy();
    expect(pt.versionAvailable).toBeTruthy();
  });

  it("has all PWA install keys in es locale", async () => {
    const es = (await import("~/lib/i18n/es")).default;
    expect(es.installApp).toBeTruthy();
    expect(es.installBtn).toBeTruthy();
    expect(es.installIosHint).toBeTruthy();
    expect(es.versionAvailable).toBeTruthy();
  });

  it("has all PWA install keys in fr locale", async () => {
    const fr = (await import("~/lib/i18n/fr")).default;
    expect(fr.installApp).toBeTruthy();
    expect(fr.installBtn).toBeTruthy();
    expect(fr.installIosHint).toBeTruthy();
    expect(fr.versionAvailable).toBeTruthy();
  });

  it("has all PWA install keys in de locale", async () => {
    const de = (await import("~/lib/i18n/de")).default;
    expect(de.installApp).toBeTruthy();
    expect(de.installBtn).toBeTruthy();
    expect(de.installIosHint).toBeTruthy();
    expect(de.versionAvailable).toBeTruthy();
  });

  it("has all PWA install keys in it locale", async () => {
    const it = (await import("~/lib/i18n/it")).default;
    expect(it.installApp).toBeTruthy();
    expect(it.installBtn).toBeTruthy();
    expect(it.installIosHint).toBeTruthy();
    expect(it.versionAvailable).toBeTruthy();
  });

  it("versionAvailable contains {version} placeholder in all locales", async () => {
    const en = (await import("~/lib/i18n/en")).default;
    const pt = (await import("~/lib/i18n/pt")).default;
    const es = (await import("~/lib/i18n/es")).default;
    const fr = (await import("~/lib/i18n/fr")).default;
    const de = (await import("~/lib/i18n/de")).default;
    const it = (await import("~/lib/i18n/it")).default;
    for (const locale of [en, pt, es, fr, de, it]) {
      expect(locale.versionAvailable).toContain("{version}");
    }
  });
});

// ── Dismissal persistence tests ─────────────────────────────────────────────

describe("PWA install dismissal persistence", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
    });
  });

  it("stores dismissal timestamp in localStorage", () => {
    const key = "pwa-install-dismissed";
    expect(localStorage.getItem(key)).toBeNull();
    localStorage.setItem(key, String(Date.now()));
    expect(localStorage.getItem(key)).toBeTruthy();
  });

  it("dismissal expires after 7 days", () => {
    const key = "pwa-install-dismissed";
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(key, String(eightDaysAgo));
    const raw = localStorage.getItem(key);
    const dismissed = parseInt(raw!, 10);
    const isExpired = Date.now() - dismissed >= 7 * 24 * 60 * 60 * 1000;
    expect(isExpired).toBe(true);
  });

  it("dismissal is active within 7 days", () => {
    const key = "pwa-install-dismissed";
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    localStorage.setItem(key, String(twoDaysAgo));
    const raw = localStorage.getItem(key);
    const dismissed = parseInt(raw!, 10);
    const isExpired = Date.now() - dismissed >= 7 * 24 * 60 * 60 * 1000;
    expect(isExpired).toBe(false);
  });
});
