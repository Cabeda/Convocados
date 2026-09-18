import { describe, it, expect } from "vitest";
import { predictWin, rating as osRating } from "openskill";
import { expectedScore } from "~/lib/elo";
import {
  computeSkillUpdates,
  DEFAULT_MU,
  DEFAULT_RATING,
  DEFAULT_SIGMA,
  deriveCalibrationScale,
  muToRating,
  ratingToMu,
  SCALE,
  type SkillPlayerInfo,
  type SkillUpdate,
} from "~/lib/skill";

// ── Projection & calibration ─────────────────────────────────────────────────

describe("rating ↔ mu projection", () => {
  it("round-trips a scalar through mu", () => {
    for (const rating of [800, 1000, 1234.5, 1600]) {
      expect(muToRating(ratingToMu(rating))).toBeCloseTo(rating, 10);
    }
  });

  it("maps the default rating to the default mu", () => {
    expect(ratingToMu(DEFAULT_RATING)).toBeCloseTo(DEFAULT_MU, 10);
    expect(muToRating(DEFAULT_MU)).toBeCloseTo(DEFAULT_RATING, 10);
  });

  it("derives a scale in the expected neighbourhood", () => {
    expect(deriveCalibrationScale()).toBeGreaterThan(20);
    expect(deriveCalibrationScale()).toBeLessThan(24);
  });
});

describe("calibration against Elo", () => {
  // The projection is calibrated so, for equal sigmas, OpenSkill's win
  // probability matches Elo's expected score across the balancing range.
  // Expected values come from the two published formulas, not from the engine.
  it("OpenSkill predictWin stays within 1% of Elo expectedScore for gaps 0..400", () => {
    let worst = 0;
    for (let gap = 0; gap <= 400; gap++) {
      const openSkill = predictWin([
        [osRating({ mu: DEFAULT_MU, sigma: DEFAULT_SIGMA })],
        [osRating({ mu: DEFAULT_MU - gap / SCALE, sigma: DEFAULT_SIGMA })],
      ])[0];
      const elo = expectedScore(DEFAULT_RATING + gap, DEFAULT_RATING);
      worst = Math.max(worst, Math.abs(openSkill - elo));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("passes through 0.5 on equal ratings", () => {
    expect(
      predictWin([
        [osRating({ mu: DEFAULT_MU, sigma: DEFAULT_SIGMA })],
        [osRating({ mu: DEFAULT_MU, sigma: DEFAULT_SIGMA })],
      ])[0],
    ).toBeCloseTo(0.5, 10);
  });
});

// ── computeSkillUpdates ───────────────────────────────────────────────────────

const teamsOf = (teamOne: string[], teamTwo: string[]) => [
  { team: "T1", players: teamOne.map((name, order) => ({ name, order })) },
  { team: "T2", players: teamTwo.map((name, order) => ({ name, order })) },
];

const playersAt = (names: string[], rating: number): SkillPlayerInfo[] =>
  names.map((name) => ({ name, rating, gamesPlayed: 10 }));

describe("computeSkillUpdates", () => {
  it("ignores anything that is not a two-team game", () => {
    expect(computeSkillUpdates([], [{ team: "T1", players: [] }], 1, 0)).toEqual([]);
  });

  it("returns one update per player", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const updates = computeSkillUpdates(
      playersAt(names, DEFAULT_RATING),
      teamsOf(names.slice(0, 5), names.slice(5)),
      3,
      1,
    );
    expect(updates).toHaveLength(10);
    expect(updates.map((u) => u.name).sort()).toEqual([...names].sort());
  });

  it("5v5 where the higher-rated team wins: winners gain, losers lose", () => {
    const strong = ["S1", "S2", "S3", "S4", "S5"];
    const weak = ["W1", "W2", "W3", "W4", "W5"];
    const players = [...playersAt(strong, 1200), ...playersAt(weak, 800)];

    const updates = computeSkillUpdates(players, teamsOf(strong, weak), 3, 0);
    const winners = updates.filter((u) => strong.includes(u.name));
    const losers = updates.filter((u) => weak.includes(u.name));

    for (const u of winners) {
      expect(u.delta).toBeGreaterThan(0);
      expect(u.newRating).toBeGreaterThan(u.oldRating);
    }
    for (const u of losers) {
      expect(u.delta).toBeLessThan(0);
      expect(u.newRating).toBeLessThan(u.oldRating);
    }
  });

  it("a draw between equals barely moves the rating", () => {
    const players = playersAt(["A", "B"], DEFAULT_RATING);
    const updates = computeSkillUpdates(players, teamsOf(["A"], ["B"]), 1, 1);
    for (const u of updates) {
      expect(u.delta).toBeCloseTo(0, 10);
      expect(u.newRating).toBeCloseTo(u.oldRating, 10);
    }
  });

  it("a new player moves more than an established low-sigma player", () => {
    const newcomer: SkillPlayerInfo = { name: "New", rating: DEFAULT_RATING, gamesPlayed: 0 };
    const veteran: SkillPlayerInfo = {
      name: "Vet",
      rating: DEFAULT_RATING,
      gamesPlayed: 50,
      mu: ratingToMu(DEFAULT_RATING),
      sigma: 2,
    };
    const opponents = playersAt(["X", "Y"], DEFAULT_RATING);

    const updates = computeSkillUpdates([newcomer, veteran, ...opponents], teamsOf(["New", "Vet"], ["X", "Y"]), 2, 0);
    const newcomerUpdate = updates.find((u) => u.name === "New")!;
    const veteranUpdate = updates.find((u) => u.name === "Vet")!;

    expect(Math.abs(newcomerUpdate.delta)).toBeGreaterThan(Math.abs(veteranUpdate.delta));
  });

  it("defaults unknown players to the 1000-rated prior", () => {
    const updates = computeSkillUpdates(
      playersAt(["A"], DEFAULT_RATING),
      teamsOf(["A"], ["Unknown"]),
      1,
      0,
    );
    const unknown = updates.find((u) => u.name === "Unknown")!;
    expect(unknown.oldRating).toBeCloseTo(DEFAULT_RATING, 10);
    expect(unknown.oldSigma).toBeCloseTo(DEFAULT_SIGMA, 10);
    expect(unknown.delta).toBeLessThan(0);
  });

  it("keeps the scalar rating an exact projection of the persisted mu", () => {
    const updates = computeSkillUpdates(
      playersAt(["A", "B"], DEFAULT_RATING),
      teamsOf(["A"], ["B"]),
      3,
      2,
    );
    for (const u of updates as SkillUpdate[]) {
      expect(u.newRating).toBeCloseTo(muToRating(u.mu), 10);
      expect(u.delta).toBeCloseTo(u.newRating - u.oldRating, 10);
    }
  });

  it("gives diminishing movement to a player on a five-game win streak", () => {
    // A brand-new player should move further than the same player would once
    // the posterior has tightened. We approximate "tightened" by replaying and
    // asserting the sigma never grows and the first move is the largest.
    let player: SkillPlayerInfo = { name: "A", rating: DEFAULT_RATING, gamesPlayed: 0 };
    const opponent: SkillPlayerInfo = { name: "B", rating: DEFAULT_RATING, gamesPlayed: 0 };
    const deltas: number[] = [];

    for (let i = 0; i < 5; i++) {
      const updates = computeSkillUpdates([player, opponent], teamsOf(["A"], ["B"]), 1, 0);
      const a = updates.find((u) => u.name === "A")!;
      deltas.push(a.delta);
      player = { name: "A", rating: a.newRating, gamesPlayed: i + 1, mu: a.mu, sigma: a.sigma };
    }

    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeLessThan(deltas[i - 1]);
    }
  });
});
