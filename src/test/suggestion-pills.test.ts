import { describe, it, expect } from "vitest";
import { mergeSuggestionPills } from "~/lib/suggestionPills";

describe("mergeSuggestionPills", () => {
  it("ranks co-play suggestions before fallback entries", () => {
    const { pills } = mergeSuggestionPills(
      [{ name: "Ranked", userId: "u-ranked" }],
      [{ name: "Fallback", userId: "u-fallback" }],
    );
    expect(pills.map((p) => p.name)).toEqual(["Ranked", "Fallback"]);
  });

  it("dedupes by userId across sources", () => {
    const { pills } = mergeSuggestionPills(
      [{ name: "Luís Lopes", userId: "u-luis" }],
      [{ name: "Luis Lopes", userId: "u-luis" }],
    );
    expect(pills).toHaveLength(1);
    expect(pills[0].name).toBe("Luís Lopes");
  });

  it("dedupes anonymous entries by case-insensitive name", () => {
    const { pills } = mergeSuggestionPills(
      [{ name: "TF", userId: null }],
      [
        { name: "tf", userId: null },
        { name: "Other", userId: null },
      ],
    );
    expect(pills.map((p) => p.name)).toEqual(["TF", "Other"]);
  });

  it("drops candidates already on the roster (currentNames)", () => {
    const { pills } = mergeSuggestionPills(
      [
        { name: "On Roster", userId: "u-1" },
        { name: "Fresh", userId: "u-2" },
      ],
      [],
      { currentNames: ["on roster"] },
    );
    expect(pills.map((p) => p.name)).toEqual(["Fresh"]);
  });

  it("returns empty array when everything is filtered", () => {
    const { pills } = mergeSuggestionPills([], [], { currentNames: ["x"] });
    expect(pills).toEqual([]);
  });

  it("preserves image and reason metadata", () => {
    const { pills } = mergeSuggestionPills(
      [{ name: "A", userId: "u-a", image: "img.png", reason: "played 5×" }],
      [],
    );
    expect(pills[0]).toMatchObject({ image: "img.png", reason: "played 5×" });
  });
});
