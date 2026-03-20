import { describe, it, expect } from "vitest";
import { getRandomTitle, getRandomTitles, titles, type TitleLocale } from "~/lib/randomTitles";

describe("getRandomTitle", () => {
  it("returns a non-empty string for 'en'", () => {
    const title = getRandomTitle("en");
    expect(title).toBeTruthy();
    expect(typeof title).toBe("string");
    expect(title.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for 'pt'", () => {
    const title = getRandomTitle("pt");
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for 'es'", () => {
    const title = getRandomTitle("es");
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for 'fr'", () => {
    const title = getRandomTitle("fr");
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for 'de'", () => {
    const title = getRandomTitle("de");
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for 'it'", () => {
    const title = getRandomTitle("it");
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  it("returns a title from the correct locale pool for each locale", () => {
    const locales: TitleLocale[] = ["en", "pt", "es", "fr", "de", "it"];
    for (const locale of locales) {
      const pool = titles[locale] as readonly string[];
      // Run multiple times to reduce flakiness
      for (let i = 0; i < 20; i++) {
        const title = getRandomTitle(locale);
        expect(pool).toContain(title);
      }
    }
  });

  it("returns titles from the locale pool, not the English pool, for non-en locales", () => {
    const nonEnLocales: TitleLocale[] = ["pt", "es", "fr", "de", "it"];
    const enPool = new Set<string>(titles.en);
    for (const locale of nonEnLocales) {
      const localePool = titles[locale] as readonly string[];
      // Collect many samples — at least some should NOT be in the English pool
      const samples = Array.from({ length: 50 }, () => getRandomTitle(locale));
      const allInEnPool = samples.every((t) => enPool.has(t));
      // The locale pools are distinct from English, so not all titles should match English
      expect(allInEnPool).toBe(false);
      // And every sample must be in the locale's own pool
      for (const s of samples) {
        expect(localePool).toContain(s);
      }
    }
  });

  it("falls back to English for unknown locale", () => {
    // @ts-expect-error testing unknown locale
    const title = getRandomTitle("unknown");
    expect(title).toBeTruthy();
    expect(titles.en as readonly string[]).toContain(title);
  });

  it("returns different titles across multiple calls (not always the same)", () => {
    const titles = new Set(Array.from({ length: 20 }, () => getRandomTitle("en")));
    // With 30+ titles, 20 calls should produce at least 2 unique ones
    expect(titles.size).toBeGreaterThan(1);
  });
});

describe("getRandomTitles", () => {
  it("returns the requested number of titles", () => {
    const titles = getRandomTitles("en", 5);
    expect(titles).toHaveLength(5);
  });

  it("returns unique titles (no duplicates)", () => {
    const titles = getRandomTitles("en", 10);
    expect(new Set(titles).size).toBe(10);
  });

  it("does not exceed pool size", () => {
    const titles = getRandomTitles("en", 999);
    expect(titles.length).toBeLessThanOrEqual(999);
    // All should be unique
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("works for all supported locales", () => {
    const locales = ["en", "pt", "es", "fr", "de", "it"] as const;
    locales.forEach((locale) => {
      const titles = getRandomTitles(locale, 3);
      expect(titles).toHaveLength(3);
      titles.forEach((t) => expect(t.length).toBeGreaterThan(0));
    });
  });
});
