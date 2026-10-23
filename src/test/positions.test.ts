import { describe, expect, it } from "vitest";
import { POSITIONS, isPosition, readPosition } from "~/lib/positions";

describe("positions", () => {
  it("carries exactly the four preference values", () => {
    expect([...POSITIONS]).toEqual(["GK", "DEF", "MID", "FWD"]);
  });

  it("accepts the four values and nothing else", () => {
    for (const p of POSITIONS) expect(isPosition(p)).toBe(true);
    for (const bad of ["gk", "GOAL", "", "GK ", 1, null, undefined, {}]) {
      expect(isPosition(bad)).toBe(false);
    }
  });
});

describe("readPosition", () => {
  it("distinguishes absent (leave alone), clear (null) and set", () => {
    expect(readPosition(undefined)).toEqual({ ok: true, position: undefined });
    expect(readPosition(null)).toEqual({ ok: true, position: null });
    expect(readPosition("")).toEqual({ ok: true, position: null });
    expect(readPosition("MID")).toEqual({ ok: true, position: "MID" });
  });

  it("refuses free text, so the column can never hold something rotation cannot read", () => {
    expect(readPosition("midfield")).toEqual({ ok: false });
    expect(readPosition("mid")).toEqual({ ok: false });
    expect(readPosition(7)).toEqual({ ok: false });
  });
});
