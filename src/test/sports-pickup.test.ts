import { describe, it, expect } from "vitest";
import { getSportPreset, SPORT_PRESETS } from "~/lib/sports";
import { playtomicSportIds, mapSportToPlaytomic } from "~/lib/playtomic";

const LOCALES = ["en", "pt", "es", "fr", "de", "it"] as const;

describe("Open Pickup sports (ADR-0021)", () => {
  it("defines the four new pickup sports with the agreed presets", () => {
    expect(getSportPreset("badminton-singles")).toMatchObject({ id: "badminton-singles", defaultMaxPlayers: 2, defaultDurationMinutes: 45, labelKey: "sportBadmintonSingles" });
    expect(getSportPreset("badminton-doubles")).toMatchObject({ id: "badminton-doubles", defaultMaxPlayers: 4, defaultDurationMinutes: 45, labelKey: "sportBadmintonDoubles" });
    expect(getSportPreset("squash")).toMatchObject({ id: "squash", defaultMaxPlayers: 2, defaultDurationMinutes: 40, labelKey: "sportSquash" });
    expect(getSportPreset("pickleball")).toMatchObject({ id: "pickleball", defaultMaxPlayers: 4, defaultDurationMinutes: 60, labelKey: "sportPickleball" });
  });

  it("maps the new sports to Playtomic sport ids", () => {
    expect(playtomicSportIds("badminton-singles")).toEqual(["BADMINTON"]);
    expect(playtomicSportIds("badminton-doubles")).toEqual(["BADMINTON"]);
    expect(playtomicSportIds("squash")).toEqual(["SQUASH"]);
    expect(playtomicSportIds("pickleball")).toEqual(["PICKLEBALL"]);
    expect(mapSportToPlaytomic("badminton-singles")).toBe("BADMINTON");
    expect(mapSportToPlaytomic("squash")).toBe("SQUASH");
  });

  it("declares the new sport labels in all six locales", async () => {
    for (const loc of LOCALES) {
      const mod = await import(`~/lib/i18n/${loc}`);
      const keys = mod.default ?? mod;
      expect(keys.sportBadmintonSingles, `${loc} sportBadmintonSingles`).toBeTruthy();
      expect(keys.sportBadmintonDoubles, `${loc} sportBadmintonDoubles`).toBeTruthy();
      expect(keys.sportSquash, `${loc} sportSquash`).toBeTruthy();
      expect(keys.sportPickleball, `${loc} sportPickleball`).toBeTruthy();
    }
  });

  it("lists the new sports in the preset registry", () => {
    const ids = SPORT_PRESETS.map((s) => s.id);
    expect(ids).toContain("badminton-singles");
    expect(ids).toContain("badminton-doubles");
    expect(ids).toContain("squash");
    expect(ids).toContain("pickleball");
  });
});