import { describe, it, expect } from "vitest";
import {
  TIER_NAMES,
  provisionalGames,
  kRank,
  seedRank,
  rankDelta,
  applyGame,
  softReset,
  displayRank,
  tierOf,
  tierEdges,
  computeSeasonRank,
  type RankGame,
} from "~/lib/seasonRank";

const EDGES = [0, 50, 100, 150, 200, 250];

describe("seasonRank — pure core", () => {
  it("exposes the six tier names", () => {
    expect(TIER_NAMES).toEqual(["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"]);
  });

  describe("provisionalGames", () => {
    it("is clamp(round(0.25N), 3, 10)", () => {
      expect(provisionalGames(8)).toBe(3); // round(2) -> floor 3
      expect(provisionalGames(20)).toBe(5);
      expect(provisionalGames(52)).toBe(10); // round(13) -> cap 10
    });
  });

  describe("kRank", () => {
    it("is 32 for seeded players regardless of games", () => {
      expect(kRank(0, { seeded: true, provisionalWindow: 3 })).toBe(32);
      expect(kRank(9, { seeded: true, provisionalWindow: 3 })).toBe(32);
    });
    it("is 64 for unseeded players inside the provisional window", () => {
      expect(kRank(0, { seeded: false, provisionalWindow: 3 })).toBe(64);
      expect(kRank(2, { seeded: false, provisionalWindow: 3 })).toBe(64);
    });
    it("drops to 32 after the provisional window", () => {
      expect(kRank(3, { seeded: false, provisionalWindow: 3 })).toBe(32);
    });
  });

  describe("seedRank", () => {
    it("is the skill above the anchor, never negative", () => {
      expect(seedRank(1000, 879)).toBe(121);
      expect(seedRank(800, 879)).toBe(0);
    });
  });

  describe("displayRank", () => {
    it("floors at 0 and rounds", () => {
      expect(displayRank(-12.3)).toBe(0);
      expect(displayRank(3.6)).toBe(4);
      expect(displayRank(3.4)).toBe(3);
    });
  });

  describe("rankDelta", () => {
    it("is round(K * (outcome - expected)) against opponent skill", () => {
      // expected(1100, 1000) ~= 0.6401 -> 32 * (1 - 0.6401) = 11.5 -> 12
      expect(rankDelta(1100, 1000, 1, { seasonGames: 9, seeded: true, provisionalWindow: 3 })).toBe(12);
      // loss symmetric: 32 * (0 - 0.3599) = -11.5 -> -12
      expect(rankDelta(1000, 1100, 0, { seasonGames: 9, seeded: true, provisionalWindow: 3 })).toBe(-12);
    });
    it("draw is 0 when skills are equal", () => {
      expect(rankDelta(1000, 1000, 0.5, { seasonGames: 9, seeded: true, provisionalWindow: 3 })).toBe(0);
    });
  });

  describe("applyGame + softReset", () => {
    it("adds the delta", () => {
      expect(applyGame(100, 12)).toBe(112);
    });
    it("pulls halfway to the seed", () => {
      expect(softReset(200, 100)).toBe(150);
      expect(softReset(0, 100)).toBe(50);
    });
  });

  describe("tierOf", () => {
    it("returns the last band whose edge is <= R", () => {
      expect(tierOf(0, EDGES)).toBe(0);
      expect(tierOf(49, EDGES)).toBe(0);
      expect(tierOf(50, EDGES)).toBe(1);
      expect(tierOf(260, EDGES)).toBe(5);
    });
  });

  describe("tierEdges", () => {
    it("returns equal-count percentile edges starting at 0", () => {
      const ranks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110];
      const edges = tierEdges(ranks, 6);
      expect(edges.length).toBe(6);
      expect(edges[0]).toBe(0);
      // strictly non-decreasing
      for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThanOrEqual(edges[i - 1]);
    });
  });

  describe("computeSeasonRank", () => {
    it("replays games in order and assigns tiers", () => {
      const games: RankGame[] = [
        { teamOne: ["A"], teamTwo: ["B"], scoreOne: 1, scoreTwo: 0 },
      ];
      const result = computeSeasonRank({
        games,
        skill: { A: 1100, B: 1000 },
        seeds: { A: 200, B: 100 },
        seeded: { A: true, B: true },
        provisionalWindow: 3,
        edges: EDGES,
      });
      const a = result.get("A")!;
      const b = result.get("B")!;
      expect(a.gamesThisSeason).toBe(1);
      expect(b.gamesThisSeason).toBe(1);
      expect(a.hidden).toBe(212);
      expect(b.hidden).toBe(88);
      expect(a.display).toBe(212);
      expect(b.display).toBe(88);
      expect(a.tier).toBe(4); // 212 in [200,250) -> Diamond
      expect(b.tier).toBe(1); // 88 in [50,100) -> Silver
      expect(a.deltas).toEqual([12]);
      expect(b.deltas).toEqual([-12]);
    });

    it("uses the fast K for unseeded players inside the window", () => {
      const games: RankGame[] = [
        { teamOne: ["A"], teamTwo: ["B"], scoreOne: 1, scoreTwo: 0 },
      ];
      const result = computeSeasonRank({
        games,
        skill: { A: 1100, B: 1000 },
        seeds: { A: 0, B: 0 },
        seeded: { A: false, B: false },
        provisionalWindow: 3,
        edges: EDGES,
      });
      // K=64 -> 64 * 0.3599 = 23.0 -> 23
      expect(result.get("A")!.deltas).toEqual([23]);
      expect(result.get("B")!.deltas).toEqual([-23]);
    });

    it("is deterministic and leaves non-participants untouched", () => {
      const games: RankGame[] = [
        { teamOne: ["A"], teamTwo: ["B"], scoreOne: 2, scoreTwo: 2 },
      ];
      const result = computeSeasonRank({
        games,
        skill: { A: 1000, B: 1000, C: 1000 },
        seeds: { A: 100, B: 100, C: 100 },
        seeded: { A: true, B: true, C: true },
        provisionalWindow: 3,
        edges: EDGES,
      });
      expect(result.get("A")!.hidden).toBe(100); // draw, equal skill
      expect(result.get("B")!.hidden).toBe(100);
      expect(result.get("C")!.hidden).toBe(100);
      expect(result.get("C")!.gamesThisSeason).toBe(0);
    });
  });
});
