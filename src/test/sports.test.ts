import { describe, it, expect } from "vitest";
import { SPORT_PRESETS, getSportPreset, getDefaultMaxPlayers } from "~/lib/sports";

describe("SPORT_PRESETS", () => {
  it("contains at least 5 presets", () => {
    expect(SPORT_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it("every preset has id, labelKey, and defaultMaxPlayers", () => {
    for (const preset of SPORT_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.labelKey).toBeTruthy();
      expect(preset.defaultMaxPlayers).toBeGreaterThanOrEqual(2);
    }
  });

  it("has unique ids", () => {
    const ids = SPORT_PRESETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getSportPreset", () => {
  it("returns the correct preset for a known sport", () => {
    const preset = getSportPreset("football-5v5");
    expect(preset.id).toBe("football-5v5");
    expect(preset.defaultMaxPlayers).toBe(10);
  });

  it("returns the correct preset for padel", () => {
    const preset = getSportPreset("padel");
    expect(preset.id).toBe("padel");
    expect(preset.defaultMaxPlayers).toBe(4);
  });

  it("returns the correct preset for football-7v7", () => {
    const preset = getSportPreset("football-7v7");
    expect(preset.id).toBe("football-7v7");
    expect(preset.defaultMaxPlayers).toBe(14);
  });

  it("returns the correct preset for football-11v11", () => {
    const preset = getSportPreset("football-11v11");
    expect(preset.id).toBe("football-11v11");
    expect(preset.defaultMaxPlayers).toBe(22);
  });

  it("falls back to first preset for unknown sport", () => {
    const preset = getSportPreset("unknown-sport");
    expect(preset.id).toBe(SPORT_PRESETS[0].id);
  });
});

describe("getDefaultMaxPlayers", () => {
  it("returns 10 for football-5v5", () => {
    expect(getDefaultMaxPlayers("football-5v5")).toBe(10);
  });

  it("returns 14 for football-7v7", () => {
    expect(getDefaultMaxPlayers("football-7v7")).toBe(14);
  });

  it("returns 22 for football-11v11", () => {
    expect(getDefaultMaxPlayers("football-11v11")).toBe(22);
  });

  it("returns 4 for padel", () => {
    expect(getDefaultMaxPlayers("padel")).toBe(4);
  });

  it("returns 2 for tennis-singles", () => {
    expect(getDefaultMaxPlayers("tennis-singles")).toBe(2);
  });

  it("returns 12 for volleyball", () => {
    expect(getDefaultMaxPlayers("volleyball")).toBe(12);
  });

  it("returns default for unknown sport", () => {
    expect(getDefaultMaxPlayers("curling")).toBe(SPORT_PRESETS[0].defaultMaxPlayers);
  });
});
