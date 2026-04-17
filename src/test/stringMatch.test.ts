import { describe, it, expect } from "vitest";
import { normalizeForMatch, matchesWithName } from "~/lib/stringMatch";

describe("normalizeForMatch", () => {
  it("lowercases input", () => {
    expect(normalizeForMatch("Alice")).toBe("alice");
  });

  it("strips accents/diacritics", () => {
    expect(normalizeForMatch("José")).toBe("jose");
    expect(normalizeForMatch("François")).toBe("francois");
    expect(normalizeForMatch("Müller")).toBe("muller");
  });

  it("handles combined diacritics", () => {
    expect(normalizeForMatch("Zé")).toBe("ze");
    expect(normalizeForMatch("João")).toBe("joao");
    expect(normalizeForMatch("Ñoño")).toBe("nono");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeForMatch("")).toBe("");
  });
});

describe("matchesWithName", () => {
  it("matches exact name", () => {
    expect(matchesWithName("Alice", "Alice")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesWithName("Alice", "alice")).toBe(true);
    expect(matchesWithName("alice", "ALICE")).toBe(true);
  });

  it("matches accent-insensitively", () => {
    expect(matchesWithName("José", "jose")).toBe(true);
    expect(matchesWithName("jose", "José")).toBe(true);
  });

  it("matches partial substrings", () => {
    expect(matchesWithName("Alice", "lic")).toBe(true);
    expect(matchesWithName("Francisco", "franc")).toBe(true);
  });

  it("returns false for non-matching query", () => {
    expect(matchesWithName("Alice", "Bob")).toBe(false);
  });

  it("matches empty query against any name", () => {
    expect(matchesWithName("Alice", "")).toBe(true);
  });
});
