import { describe, expect, it } from "vitest";
import {
  getDefaultFormation,
  getFormation,
  getFormationsForSport,
} from "~/lib/formations";

describe("formations", () => {
  it("exposes football-11v11 formations including 4-3-3 with 11 slots", () => {
    const formations = getFormationsForSport("football-11v11");
    const fourThreeThree = getFormation("football-11v11", "4-3-3");

    expect(formations.map((f) => f.id)).toContain("4-3-3");
    expect(fourThreeThree?.slots).toHaveLength(11);
  });

  it("exposes a 4-2-4 for football-11v11", () => {
    expect(getFormation("football-11v11", "4-2-4")?.slots).toHaveLength(11);
  });

  it("gives futsal its own 2-2 and 1-2-1 shapes", () => {
    expect(getFormationsForSport("futsal").map((f) => f.id)).toEqual(["2-2", "1-2-1", "3-1"]);
  });

  it("returns the first formation as the default", () => {
    expect(getDefaultFormation("football-7v7").id).toBe("2-3-1");
  });

  it("falls back to a generic set for an unknown sport", () => {
    const formations = getFormationsForSport("curling");
    expect(formations.length).toBeGreaterThan(0);
    expect(formations[0].slots.length).toBeGreaterThan(0);
  });

  it("keeps every slot inside the normalized half", () => {
    for (const sport of ["football-11v11", "football-7v7", "futsal", "basketball", "volleyball"]) {
      for (const formation of getFormationsForSport(sport)) {
        for (const slot of formation.slots) {
          expect(slot.x).toBeGreaterThanOrEqual(0);
          expect(slot.x).toBeLessThanOrEqual(1);
          expect(slot.y).toBeGreaterThanOrEqual(0);
          expect(slot.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("returns undefined for an unknown formation id", () => {
    expect(getFormation("football-11v11", "9-9-9")).toBeUndefined();
    expect(getFormation("football-11v11", null)).toBeUndefined();
  });
});
