import { describe, it, expect } from "vitest";
import {
  expectedScore,
  kFactor,
  computeRatingDelta,
  computeGameUpdates,
  type EloUpdate,
} from "~/lib/elo";

// ── expectedScore ─────────────────────────────────────────────────────────────

describe("expectedScore", () => {
  it("equal ratings give 0.5", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
  });

  it("higher-rated player has > 0.5", () => {
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
  });

  it("lower-rated player has < 0.5", () => {
    expect(expectedScore(800, 1000)).toBeLessThan(0.5);
  });

  it("400-point gap gives ~0.91", () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 2);
  });

  it("is symmetric: E(a,b) + E(b,a) = 1", () => {
    expect(expectedScore(1100, 900) + expectedScore(900, 1100)).toBeCloseTo(1);
  });

  it("800-point gap gives ~0.99", () => {
    expect(expectedScore(1800, 1000)).toBeCloseTo(0.99, 1);
  });
});

// ── kFactor ───────────────────────────────────────────────────────────────────

describe("kFactor", () => {
  it("returns 48 for provisional players (< 6 games)", () => {
    expect(kFactor(0)).toBe(48);
    expect(kFactor(3)).toBe(48);
    expect(kFactor(5)).toBe(48);
  });

  it("returns 32 for established players (>= 6 games)", () => {
    expect(kFactor(6)).toBe(32);
    expect(kFactor(10)).toBe(32);
    expect(kFactor(50)).toBe(32);
    expect(kFactor(100)).toBe(32);
  });
});

// ── computeRatingDelta ────────────────────────────────────────────────────────

describe("computeRatingDelta", () => {
  it("win against equal opponent gives positive delta", () => {
    const delta = computeRatingDelta(1000, 1000, 1, 10);
    expect(delta).toBeGreaterThan(0);
  });

  it("loss against equal opponent gives negative delta", () => {
    const delta = computeRatingDelta(1000, 1000, 0, 10);
    expect(delta).toBeLessThan(0);
  });

  it("draw against equal opponent gives 0 delta", () => {
    const delta = computeRatingDelta(1000, 1000, 0.5, 10);
    expect(delta).toBe(0);
  });

  it("win against equal opponent with K=32 gives +16", () => {
    const delta = computeRatingDelta(1000, 1000, 1, 10);
    expect(delta).toBe(16); // 32 * (1 - 0.5) = 16
  });

  it("loss against equal opponent with K=32 gives -16", () => {
    const delta = computeRatingDelta(1000, 1000, 0, 10);
    expect(delta).toBe(-16);
  });

  it("provisional player (K=48) gets larger delta", () => {
    const provisional = computeRatingDelta(1000, 1000, 1, 3);
    const established = computeRatingDelta(1000, 1000, 1, 15);
    expect(provisional).toBe(24); // 48 * 0.5
    expect(established).toBe(16); // 32 * 0.5
    expect(provisional).toBeGreaterThan(established);
  });

  it("win against stronger opponent gives larger delta", () => {
    const vsStronger = computeRatingDelta(1000, 1200, 1, 10);
    const vsEqual = computeRatingDelta(1000, 1000, 1, 10);
    expect(vsStronger).toBeGreaterThan(vsEqual);
  });

  it("win against weaker opponent gives smaller delta", () => {
    const vsWeaker = computeRatingDelta(1200, 1000, 1, 10);
    const vsEqual = computeRatingDelta(1000, 1000, 1, 10);
    expect(vsWeaker).toBeLessThan(vsEqual);
  });

  it("loss against weaker opponent gives larger penalty", () => {
    const vsWeaker = computeRatingDelta(1200, 1000, 0, 10);
    const vsEqual = computeRatingDelta(1000, 1000, 0, 10);
    expect(Math.abs(vsWeaker)).toBeGreaterThan(Math.abs(vsEqual));
  });
});

// ── computeGameUpdates ────────────────────────────────────────────────────────

describe("computeGameUpdates", () => {
  it("returns updates for all players", () => {
    const players = [
      { name: "A", rating: 1000, gamesPlayed: 5 },
      { name: "B", rating: 1000, gamesPlayed: 5 },
      { name: "C", rating: 1000, gamesPlayed: 5 },
      { name: "D", rating: 1000, gamesPlayed: 5 },
    ];
    const teams = [
      { team: "T1", players: [{ name: "A", order: 0 }, { name: "B", order: 1 }] },
      { team: "T2", players: [{ name: "C", order: 0 }, { name: "D", order: 1 }] },
    ];
    const updates = computeGameUpdates(players, teams, 3, 1);
    expect(updates).toHaveLength(4);
    expect(updates.map((u: EloUpdate) => u.name).sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("winning team gets positive deltas, losing team gets negative", () => {
    const players = [
      { name: "A", rating: 1000, gamesPlayed: 10 },
      { name: "B", rating: 1000, gamesPlayed: 10 },
      { name: "C", rating: 1000, gamesPlayed: 10 },
      { name: "D", rating: 1000, gamesPlayed: 10 },
    ];
    const teams = [
      { team: "T1", players: [{ name: "A", order: 0 }, { name: "B", order: 1 }] },
      { team: "T2", players: [{ name: "C", order: 0 }, { name: "D", order: 1 }] },
    ];
    const updates = computeGameUpdates(players, teams, 2, 0);

    const t1Updates = updates.filter((u: EloUpdate) => ["A", "B"].includes(u.name));
    const t2Updates = updates.filter((u: EloUpdate) => ["C", "D"].includes(u.name));

    for (const u of t1Updates) {
      expect(u.delta).toBeGreaterThan(0);
      expect(u.newRating).toBeGreaterThan(u.oldRating);
    }
    for (const u of t2Updates) {
      expect(u.delta).toBeLessThan(0);
      expect(u.newRating).toBeLessThan(u.oldRating);
    }
  });

  it("draw gives 0 delta for equal-rated players", () => {
    const players = [
      { name: "A", rating: 1000, gamesPlayed: 10 },
      { name: "B", rating: 1000, gamesPlayed: 10 },
    ];
    const teams = [
      { team: "T1", players: [{ name: "A", order: 0 }] },
      { team: "T2", players: [{ name: "B", order: 0 }] },
    ];
    const updates = computeGameUpdates(players, teams, 1, 1);
    for (const u of updates) {
      expect(u.delta).toBe(0);
      expect(u.newRating).toBe(u.oldRating);
    }
  });

  it("total rating change sums to zero (zero-sum)", () => {
    const players = [
      { name: "A", rating: 1200, gamesPlayed: 15 },
      { name: "B", rating: 1100, gamesPlayed: 15 },
      { name: "C", rating: 1000, gamesPlayed: 15 },
      { name: "D", rating: 900, gamesPlayed: 15 },
    ];
    const teams = [
      { team: "T1", players: [{ name: "A", order: 0 }, { name: "D", order: 1 }] },
      { team: "T2", players: [{ name: "B", order: 0 }, { name: "C", order: 1 }] },
    ];
    const updates = computeGameUpdates(players, teams, 3, 2);
    const totalDelta = updates.reduce((sum: number, u: EloUpdate) => sum + u.delta, 0);
    // Due to rounding, allow ±1 per player
    expect(Math.abs(totalDelta)).toBeLessThanOrEqual(updates.length);
  });

  it("uses default 1000 rating for unknown players", () => {
    const players = [
      { name: "A", rating: 1000, gamesPlayed: 10 },
    ];
    const teams = [
      { team: "T1", players: [{ name: "A", order: 0 }] },
      { team: "T2", players: [{ name: "Unknown", order: 0 }] },
    ];
    const updates = computeGameUpdates(players, teams, 1, 0);
    const unknown = updates.find((u: EloUpdate) => u.name === "Unknown")!;
    expect(unknown.oldRating).toBe(1000);
    expect(unknown.delta).toBeLessThan(0); // lost
  });

  it("provisional players get larger rating changes", () => {
    const players = [
      { name: "Provisional", rating: 1000, gamesPlayed: 2 },
      { name: "Established", rating: 1000, gamesPlayed: 20 },
    ];
    const teams = [
      { team: "T1", players: [{ name: "Provisional", order: 0 }] },
      { team: "T2", players: [{ name: "Established", order: 0 }] },
    ];
    const updates = computeGameUpdates(players, teams, 2, 0);
    const prov = updates.find((u: EloUpdate) => u.name === "Provisional")!;
    const est = updates.find((u: EloUpdate) => u.name === "Established")!;
    expect(Math.abs(prov.delta)).toBeGreaterThan(Math.abs(est.delta));
  });

  it("handles uneven team sizes", () => {
    const players = [
      { name: "A", rating: 1000, gamesPlayed: 10 },
      { name: "B", rating: 1000, gamesPlayed: 10 },
      { name: "C", rating: 1000, gamesPlayed: 10 },
    ];
    const teams = [
      { team: "T1", players: [{ name: "A", order: 0 }, { name: "B", order: 1 }] },
      { team: "T2", players: [{ name: "C", order: 0 }] },
    ];
    const updates = computeGameUpdates(players, teams, 1, 0);
    expect(updates).toHaveLength(3);
  });

  it("multi-game progression: winner rating increases over time", () => {
    let aRating = 1000;
    let bRating = 1000;
    let aGames = 0;
    let bGames = 0;

    // A wins 5 games in a row
    for (let i = 0; i < 5; i++) {
      const players = [
        { name: "A", rating: aRating, gamesPlayed: aGames },
        { name: "B", rating: bRating, gamesPlayed: bGames },
      ];
      const teams = [
        { team: "T1", players: [{ name: "A", order: 0 }] },
        { team: "T2", players: [{ name: "B", order: 0 }] },
      ];
      const updates = computeGameUpdates(players, teams, 1, 0);
      aRating = updates.find((u: EloUpdate) => u.name === "A")!.newRating;
      bRating = updates.find((u: EloUpdate) => u.name === "B")!.newRating;
      aGames++;
      bGames++;
    }

    expect(aRating).toBeGreaterThan(1000);
    expect(bRating).toBeLessThan(1000);
    expect(aRating + bRating).toBeCloseTo(2000, -1); // approximately zero-sum
  });

  it("diminishing returns: each consecutive win gives smaller delta", () => {
    let aRating = 1000;
    let bRating = 1000;
    let aGames = 10;
    let bGames = 10;
    const deltas: number[] = [];

    for (let i = 0; i < 5; i++) {
      const players = [
        { name: "A", rating: aRating, gamesPlayed: aGames },
        { name: "B", rating: bRating, gamesPlayed: bGames },
      ];
      const teams = [
        { team: "T1", players: [{ name: "A", order: 0 }] },
        { team: "T2", players: [{ name: "B", order: 0 }] },
      ];
      const updates = computeGameUpdates(players, teams, 1, 0);
      const aDelta = updates.find((u: EloUpdate) => u.name === "A")!.delta;
      deltas.push(aDelta);
      aRating = updates.find((u: EloUpdate) => u.name === "A")!.newRating;
      bRating = updates.find((u: EloUpdate) => u.name === "B")!.newRating;
      aGames++;
      bGames++;
    }

    // Each win should give less points as the gap widens
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeLessThanOrEqual(deltas[i - 1]);
    }
  });
});
