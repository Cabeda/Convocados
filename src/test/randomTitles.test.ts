import { describe, it, expect } from "vitest";
import { getRandomTitle, getRandomTitles } from "~/lib/randomTitles";

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

  it("falls back to English for unknown locale", () => {
    // @ts-expect-error testing unknown locale
    const title = getRandomTitle("fr");
    expect(title).toBeTruthy();
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

  it("works for Portuguese locale", () => {
    const titles = getRandomTitles("pt", 3);
    expect(titles).toHaveLength(3);
    titles.forEach((t) => expect(t.length).toBeGreaterThan(0));
  });
});
