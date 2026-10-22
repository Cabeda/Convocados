import { describe, it, expect } from "vitest";
import { inferCity, normalizeCity } from "~/lib/city";

describe("normalizeCity", () => {
  it("trims, collapses whitespace and capitalises each word", () => {
    expect(normalizeCity("  lisboa ")).toBe("Lisboa");
    expect(normalizeCity("vila   nova de gaia")).toBe("Vila Nova de Gaia");
  });

  it("keeps small connectors lowercase", () => {
    expect(normalizeCity("TORRES DE VEDRAS")).toBe("Torres de Vedras");
  });

  it("keeps accents", () => {
    expect(normalizeCity("évora")).toBe("Évora");
    expect(normalizeCity("são joão")).toBe("São João");
  });

  it("returns the same value for any casing, so an exact filter is case-insensitive", () => {
    const spellings = ["Lisboa", "lisboa", "LISBOA", " LiSBoA "];
    for (const spelling of spellings) expect(normalizeCity(spelling)).toBe("Lisboa");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeCity("")).toBe("");
    expect(normalizeCity("   ")).toBe("");
  });
});

describe("inferCity", () => {
  it("takes the city segment of a 'venue, city' location", () => {
    expect(inferCity("Campo Maior, Lisboa")).toBe("Lisboa");
  });

  it("drops a leading postcode", () => {
    expect(inferCity("Pavilhão Municipal, 1200-100 Lisboa")).toBe("Lisboa");
  });

  it("falls back to the whole location when there is no comma", () => {
    expect(inferCity("lisboa")).toBe("Lisboa");
  });

  it("returns an empty string when there is nothing to guess", () => {
    expect(inferCity("")).toBe("");
    expect(inferCity(" , ")).toBe("");
  });
});
