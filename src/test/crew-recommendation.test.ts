import { describe, expect, it } from "vitest";
import { recommendCrews } from "~/lib/crewRecommendation";

describe("recommendCrews", () => {
  it("assigns every participant once into balanced crews of three to five", () => {
    const result = recommendCrews([
      { membershipId: "m1", name: "A", rating: 1400 },
      { membershipId: "m2", name: "B", rating: 1300 },
      { membershipId: "m3", name: "C", rating: 1200 },
      { membershipId: "m4", name: "D", rating: 1100 },
      { membershipId: "m5", name: "E", rating: 1000 },
      { membershipId: "m6", name: "F", rating: 900 },
      { membershipId: "m7", name: "G", rating: 800 },
      { membershipId: "m8", name: "H", rating: 700 },
    ], 2);

    expect(result.errors).toEqual([]);
    expect(result.crews).toHaveLength(2);
    expect(result.crews.map((crew) => crew.membershipIds.length).sort()).toEqual([4, 4]);
    expect(result.crews.flatMap((crew) => crew.membershipIds).sort()).toEqual([
      "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8",
    ]);
    expect(Math.abs(result.crews[0].averageRating - result.crews[1].averageRating)).toBeLessThanOrEqual(100);
  });

  it("rejects a crew count whose groups cannot all contain three to five participants", () => {
    const result = recommendCrews([
      { membershipId: "m1", name: "A", rating: 1000 },
      { membershipId: "m2", name: "B", rating: 1000 },
      { membershipId: "m3", name: "C", rating: 1000 },
      { membershipId: "m4", name: "D", rating: 1000 },
      { membershipId: "m5", name: "E", rating: 1000 },
    ], 1);

    expect(result.crews).toEqual([]);
    expect(result.errors).toContain("Crew count must be at least 2.");
  });

  it("uses stable membership IDs and deterministic tie breaks", () => {
    const players = [
      { membershipId: "m2", name: "B", rating: 1000 },
      { membershipId: "m1", name: "A", rating: 1000 },
      { membershipId: "m3", name: "C", rating: 1000 },
      { membershipId: "m4", name: "D", rating: 1000 },
      { membershipId: "m5", name: "E", rating: 1000 },
      { membershipId: "m6", name: "F", rating: 1000 },
    ];

    const first = recommendCrews(players, 2);
    const second = recommendCrews([...players].reverse(), 2);

    expect(first).toEqual(second);
    expect(first.crews.flatMap((crew) => crew.membershipIds)).not.toContain(undefined);
  });
});


  it("balances highly skewed ratings instead of only alternating slots", () => {
    const result = recommendCrews([
      { membershipId: "m1", name: "A", rating: 1000 },
      { membershipId: "m2", name: "B", rating: 999 },
      { membershipId: "m3", name: "C", rating: 998 },
      { membershipId: "m4", name: "D", rating: 1 },
      { membershipId: "m5", name: "E", rating: 1 },
      { membershipId: "m6", name: "F", rating: 1 },
    ], 2);

    expect(Math.abs(result.crews[0].averageRating - result.crews[1].averageRating)).toBeLessThanOrEqual(333);
  });


it("rejects an empty participant list", () => {
  const result = recommendCrews([], 2);
  expect(result.crews).toEqual([]);
  expect(result.errors).toContain("At least one participant is required.");
});

it("rejects duplicate membership IDs", () => {
  const result = recommendCrews([
    { membershipId: "dup", name: "A", rating: 1000 },
    { membershipId: "dup", name: "B", rating: 1000 },
    { membershipId: "m3", name: "C", rating: 1000 },
    { membershipId: "m4", name: "D", rating: 1000 },
    { membershipId: "m5", name: "E", rating: 1000 },
    { membershipId: "m6", name: "F", rating: 1000 },
  ], 2);
  expect(result.crews).toEqual([]);
  expect(result.errors).toContain("Participant membership IDs must be unique.");
});

it("rejects too few participants for the requested crew count", () => {
  const result = recommendCrews([
    { membershipId: "m1", name: "A", rating: 1000 },
    { membershipId: "m2", name: "B", rating: 1000 },
    { membershipId: "m3", name: "C", rating: 1000 },
    { membershipId: "m4", name: "D", rating: 1000 },
    { membershipId: "m5", name: "E", rating: 1000 },
  ], 2); // 2 crews need 6–10
  expect(result.crews).toEqual([]);
  expect(result.errors[0]).toMatch(/require between/);
});

it("rejects too many participants for the requested crew count", () => {
  const players = Array.from({ length: 11 }, (_, i) => ({ membershipId: `m${i}`, name: `P${i}`, rating: 1000 }));
  const result = recommendCrews(players, 2); // 2 crews cap at 10
  expect(result.crews).toEqual([]);
  expect(result.errors[0]).toMatch(/require between/);
});

describe("recommendCrews with season history", () => {
  it("keeps previous-season Crews together when sizes allow", () => {
    const result = recommendCrews([
      { membershipId: "m1", name: "A", rating: 1000, gamesPlayed: 5, previousCrewId: "crew-a" },
      { membershipId: "m2", name: "B", rating: 990, gamesPlayed: 4, previousCrewId: "crew-a" },
      { membershipId: "m3", name: "C", rating: 980, gamesPlayed: 6, previousCrewId: "crew-a" },
      { membershipId: "m4", name: "D", rating: 970, gamesPlayed: 5, previousCrewId: "crew-b" },
      { membershipId: "m5", name: "E", rating: 960, gamesPlayed: 4, previousCrewId: "crew-b" },
      { membershipId: "m6", name: "F", rating: 950, gamesPlayed: 6, previousCrewId: "crew-b" },
    ], 2);

    expect(result.errors).toEqual([]);
    const crewIndexFor = (membershipId: string) => result.crews.findIndex((crew) => crew.membershipIds.includes(membershipId));
    expect(new Set(["m1", "m2", "m3"].map(crewIndexFor)).size).toBe(1);
    expect(new Set(["m4", "m5", "m6"].map(crewIndexFor)).size).toBe(1);
    expect(crewIndexFor("m1")).not.toBe(crewIndexFor("m4"));
  });

  it("keeps only actively-attending members grouped; inactive ones are free agents", () => {
    const result = recommendCrews([
      { membershipId: "m1", name: "A", rating: 1000, gamesPlayed: 5, previousCrewId: "crew-a" },
      { membershipId: "m2", name: "B", rating: 990, gamesPlayed: 4, previousCrewId: "crew-a" },
      { membershipId: "m3", name: "C", rating: 980, gamesPlayed: 0, previousCrewId: "crew-a" },
      { membershipId: "m4", name: "D", rating: 970, gamesPlayed: 5 },
      { membershipId: "m5", name: "E", rating: 960, gamesPlayed: 4 },
      { membershipId: "m6", name: "F", rating: 950, gamesPlayed: 4 },
    ], 2);

    expect(result.errors).toEqual([]);
    const crewOf = (membershipId: string) => result.crews.find((crew) => crew.membershipIds.includes(membershipId))!;
    const crewA = crewOf("m1");
    // The two active members of the old Crew stay together…
    expect(crewA.membershipIds).toContain("m2");
    // …and the inactive member (C) does not anchor the Crew around him.
    expect(crewOf("m3").membershipIds).not.toEqual(expect.arrayContaining(["m1", "m2"]));
    expect(result.crews.flatMap((crew) => crew.membershipIds).sort()).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
  });

  it("splits an oversized previous-season Crew into several balanced Crews", () => {
    const players = Array.from({ length: 12 }, (_, index) => ({
      membershipId: `m${index}`,
      name: `P${index}`,
      rating: 1200 - index * 10,
      gamesPlayed: 5,
      previousCrewId: "huge",
    }));
    const result = recommendCrews(players, 3);

    expect(result.errors).toEqual([]);
    expect(result.crews.map((crew) => crew.membershipIds.length).sort()).toEqual([4, 4, 4]);
    const distinctCrews = new Set(result.crews.flatMap((crew) => crew.membershipIds.map(() => 0)).map((_, index) => {
      return result.crews.findIndex((crew) => crew.membershipIds.includes(`m${index}`));
    }));
    expect(distinctCrews.size).toBeGreaterThan(1);
  });

  it("keeps the previous grouping when ratings are already balanced (small changes only)", () => {
    const result = recommendCrews([
      { membershipId: "m1", name: "A", rating: 1010, gamesPlayed: 5, previousCrewId: "crew-a" },
      { membershipId: "m2", name: "B", rating: 1000, gamesPlayed: 4, previousCrewId: "crew-a" },
      { membershipId: "m3", name: "C", rating: 990, gamesPlayed: 6, previousCrewId: "crew-a" },
      { membershipId: "m4", name: "D", rating: 1000, gamesPlayed: 5, previousCrewId: "crew-b" },
      { membershipId: "m5", name: "E", rating: 990, gamesPlayed: 4, previousCrewId: "crew-b" },
      { membershipId: "m6", name: "F", rating: 980, gamesPlayed: 6, previousCrewId: "crew-b" },
    ], 2);

    expect(result.errors).toEqual([]);
    const crewIndexFor = (membershipId: string) => result.crews.findIndex((crew) => crew.membershipIds.includes(membershipId));
    expect(new Set(["m1", "m2", "m3"].map(crewIndexFor)).size).toBe(1);
    expect(new Set(["m4", "m5", "m6"].map(crewIndexFor)).size).toBe(1);
  });
});
