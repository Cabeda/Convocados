import { describe, expect, it } from "vitest";
import { parseCoverageSummary, parseThresholds, thresholdsLowered } from "../../scripts/nightshift/coverage";

const CONFIG = `
  coverage: {
    thresholds: {
      lines: 88,
      statements: 87.5,
      functions: 80,
      branches: 84.2,
    },
  },
`;

describe("parseThresholds", () => {
  it("reads the four thresholds", () => {
    expect(parseThresholds(CONFIG)).toEqual({ lines: 88, statements: 87.5, functions: 80, branches: 84.2 });
  });

  it("omits thresholds that are absent", () => {
    expect(parseThresholds("thresholds: { lines: 90 }")).toEqual({ lines: 90 });
  });
});

describe("thresholdsLowered", () => {
  it("is false when nothing moved", () => {
    const t = parseThresholds(CONFIG);
    expect(thresholdsLowered(t, t)).toBe(false);
  });

  it("is false when a threshold was raised", () => {
    expect(thresholdsLowered({ lines: 88 }, { lines: 90 })).toBe(false);
  });

  it("is true when any single threshold dropped", () => {
    expect(thresholdsLowered(parseThresholds(CONFIG), { ...parseThresholds(CONFIG), branches: 80 })).toBe(true);
  });

  it("ignores a key absent on either side", () => {
    expect(thresholdsLowered({ lines: 88 }, { statements: 10 })).toBe(false);
  });
});

describe("parseCoverageSummary", () => {
  it("reads the All files line", () => {
    const report = [
      " % Coverage report from v8",
      "----------|---------|----------|---------|---------|",
      "File      | % Stmts | % Branch | % Funcs | % Lines |",
      "----------|---------|----------|---------|---------|",
      "All files |   90.12 |    85.30 |   88.00 |   90.10 |",
      "----------|---------|----------|---------|---------|",
    ].join("\n");
    expect(parseCoverageSummary(report)).toBe(90.12);
  });

  it("returns null when the row is missing", () => {
    expect(parseCoverageSummary("no table here")).toBeNull();
  });
});
