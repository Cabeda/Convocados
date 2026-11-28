import { describe, it, expect } from "vitest";
import { formatMoney, formatMoneyCompact, toCents } from "~/lib/money";

// Seam: `src/lib/money.ts` — the one money format every surface renders through.
describe("formatMoney — the one money format", () => {
  it("renders two decimals then the symbol, with no space", () => {
    expect(formatMoney(5000, "EUR")).toBe("50.00€");
    expect(formatMoney(750, "EUR")).toBe("7.50€");
    expect(formatMoney(12000, "EUR")).toBe("120.00€");
  });

  it("puts the symbol after the amount for every currency the app supports", () => {
    expect(formatMoney(5000, "USD")).toBe("50.00$");
    expect(formatMoney(5000, "GBP")).toBe("50.00£");
    expect(formatMoney(5000, "BRL")).toBe("50.00R$");
  });

  it("renders an unknown currency as its own code instead of guessing a symbol", () => {
    expect(formatMoney(5000, "XYZ")).toBe("50.00XYZ");
  });

  it("normalizes the currency code it is handed", () => {
    expect(formatMoney(5000, "eur")).toBe("50.00€");
    expect(formatMoney(5000, " eur ")).toBe("50.00€");
    expect(formatMoney(5000, "xyz")).toBe("50.00XYZ");
  });

  it("falls back to EUR when the Event carries no currency", () => {
    expect(formatMoney(5000)).toBe("50.00€");
    expect(formatMoney(5000, null)).toBe("50.00€");
    expect(formatMoney(5000, "")).toBe("50.00€");
  });

  it("renders integer cents exactly, with no float drift (ADR 0007)", () => {
    expect(formatMoney(0, "EUR")).toBe("0.00€");
    expect(formatMoney(5, "EUR")).toBe("0.05€");
    expect(formatMoney(999, "EUR")).toBe("9.99€");
    expect(formatMoney(-250, "EUR")).toBe("-2.50€");
    expect(formatMoney(1234567, "EUR")).toBe("12345.67€");
  });
});

describe("toCents — the boundary for the legacy float amounts", () => {
  it("converts an amount in major units to integer cents", () => {
    expect(toCents(50)).toBe(5000);
    expect(toCents(7.5)).toBe(750);
    expect(toCents(9.99)).toBe(999);
  });

  it("rounds away the float artefact at the boundary, once", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe("formatMoneyCompact — the story card's quiet money format", () => {
  it("drops the decimals of a whole amount and keeps them otherwise", () => {
    expect(formatMoneyCompact(5, "EUR", "en")).toBe("€5");
    expect(formatMoneyCompact(2.5, "EUR", "en")).toBe("€2.50");
    expect(formatMoneyCompact(12.345, "EUR", "en")).toBe("€12.35");
  });

  it("puts the symbol where the locale expects it", () => {
    expect(formatMoneyCompact(5, "EUR", "de")).toMatch(/^5\s€$/);
    expect(formatMoneyCompact(2.5, "EUR", "fr")).toMatch(/^2,50\s€$/);
    expect(formatMoneyCompact(5, "EUR", "pt")).toMatch(/€\s?5$/);
  });

  it("uses the narrow symbol of the currency", () => {
    expect(formatMoneyCompact(5, "USD", "en")).toBe("$5");
    expect(formatMoneyCompact(5, "GBP", "en")).toBe("£5");
    expect(formatMoneyCompact(5, "BRL", "en")).toBe("R$5");
  });

  it("falls back to EUR when the currency is missing and never throws on a bad one", () => {
    expect(formatMoneyCompact(5, null, "en")).toBe("€5");
    expect(() => formatMoneyCompact(5, "not-a-currency", "en")).not.toThrow();
  });

  it("does not touch the global formatter", () => {
    expect(formatMoney(500, "EUR")).toBe("5.00€");
  });
});
