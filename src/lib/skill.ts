/**
 * OpenSkill (Weng–Lin) engine for the hidden lifetime Skill Rating — pure, no DB.
 *
 * The rest of the app only ever sees a 1000-centred scalar (`rating`). That scalar
 * is a calibrated linear projection of OpenSkill's `mu`; underneath we keep each
 * player's posterior `(mu, sigma)` so a team result updates every member using
 * the uncertainty the naive per-player Elo engine threw away.
 *
 * This module mirrors the contract of `src/lib/elo.ts` (`computeGameUpdates`):
 * same argument shape, same `{ name, oldRating, newRating, delta }` result, plus
 * the posterior `{ mu, sigma }` for persistence.
 */

import { predictWin, rate, rating, type Rating } from "openskill";
import { expectedScore } from "./elo";

/** Scalar rating a brand-new player starts at (the app's Elo origin). */
export const DEFAULT_RATING = 1000;

/** OpenSkill's default prior mean. */
export const DEFAULT_MU = 25;

/** OpenSkill's default prior standard deviation (25 / 3). */
export const DEFAULT_SIGMA = 25 / 3;

/**
 * OpenSkill win probability for player A given a rating gap on our projected
 * scale. Both players use the default sigma, isolating the projection shape.
 */
function winProbabilityForGap(ratingGap: number, scale: number): number {
  const teams: [Rating[], Rating[]] = [
    [rating({ mu: DEFAULT_MU, sigma: DEFAULT_SIGMA })],
    [rating({ mu: DEFAULT_MU - ratingGap / scale, sigma: DEFAULT_SIGMA })],
  ];
  return predictWin(teams)[0];
}

/**
 * Derive the projection `SCALE` numerically.
 *
 * OpenSkill's `predictWin` is a normal CDF; Elo's `expectedScore` is a logistic
 * curve. No single linear map makes them identical, so we pick the scale that
 * minimises the worst-case absolute difference over rating gaps 0..400 (the
 * range that matters for balancing). A coarse scan followed by a local refine
 * keeps the derivation cheap enough to run at module load (also in the browser).
 *
 * The minimax fit lands at ≈ 22.07 with a worst-case error of ≈ 0.0064 (< 1%).
 * `src/test/skill.test.ts` asserts that tolerance, so the constant is justified
 * rather than magic.
 */
export function deriveCalibrationScale(): number {
  const gaps: number[] = [];
  for (let gap = 0; gap <= 400; gap += 10) gaps.push(gap);

  const worstError = (scale: number): number => {
    let worst = 0;
    for (const gap of gaps) {
      const openSkill = winProbabilityForGap(gap, scale);
      const elo = expectedScore(DEFAULT_RATING + gap, DEFAULT_RATING);
      worst = Math.max(worst, Math.abs(openSkill - elo));
    }
    return worst;
  };

  let best = 1;
  let bestError = Infinity;

  for (let scale = 5; scale <= 60; scale += 0.25) {
    const error = worstError(scale);
    if (error < bestError) {
      bestError = error;
      best = scale;
    }
  }
  for (let scale = best - 0.25; scale <= best + 0.25; scale += 0.0025) {
    const error = worstError(scale);
    if (error < bestError) {
      bestError = error;
      best = scale;
    }
  }

  return best;
}

/**
 * Projection constant between OpenSkill `mu` and the app's 1000-centred scale:
 * `rating = 1000 + (mu - 25) * SCALE`. Derived — see `deriveCalibrationScale`.
 */
export const SCALE = deriveCalibrationScale();

/** Project an OpenSkill posterior mean onto the app's 1000-centred rating. */
export function muToRating(mu: number): number {
  return DEFAULT_RATING + (mu - DEFAULT_MU) * SCALE;
}

/** Inverse projection — seed a `mu` for a rating that predates OpenSkill. */
export function ratingToMu(value: number): number {
  return DEFAULT_MU + (value - DEFAULT_RATING) / SCALE;
}

export interface SkillPlayerInfo {
  name: string;
  rating: number;
  gamesPlayed: number;
  /** Posterior mean when already tracked; absent → derived from `rating`. */
  mu?: number;
  /** Posterior std-dev when already tracked; absent → `DEFAULT_SIGMA`. */
  sigma?: number;
}

export interface SkillUpdate {
  name: string;
  oldRating: number;
  newRating: number;
  delta: number;
  oldMu: number;
  oldSigma: number;
  mu: number;
  sigma: number;
}

interface TeamSnapshot {
  team: string;
  players: { name: string; order: number }[];
}

/** Seed an OpenSkill rating from a tracked posterior, else from the scalar. */
function seedRating(player: SkillPlayerInfo): Rating {
  if (typeof player.mu === "number" && typeof player.sigma === "number") {
    return { mu: player.mu, sigma: player.sigma };
  }
  return { mu: ratingToMu(player.rating), sigma: DEFAULT_SIGMA };
}

/**
 * Compute OpenSkill updates for every player in a two-team game.
 *
 * Mirrors `computeGameUpdates`: players missing from `players` default to a
 * fresh 1000-rated prior. Scores are passed to OpenSkill's `score` option, so
 * an equal score across both teams is treated as a draw.
 */
export function computeSkillUpdates(
  players: SkillPlayerInfo[],
  teams: TeamSnapshot[],
  scoreOne: number,
  scoreTwo: number,
): SkillUpdate[] {
  if (teams.length !== 2) return [];

  const byName = new Map(players.map((p) => [p.name, p]));
  const resolve = (name: string): SkillPlayerInfo =>
    byName.get(name) ?? { name, rating: DEFAULT_RATING, gamesPlayed: 0 };

  const teamOneNames = teams[0].players.map((p) => p.name);
  const teamTwoNames = teams[1].players.map((p) => p.name);

  const teamRatings = [teamOneNames, teamTwoNames].map((names) =>
    names.map((name) => seedRating(resolve(name))),
  );
  const rated = rate(teamRatings, { score: [scoreOne, scoreTwo] });

  const updates: SkillUpdate[] = [];

  const collect = (names: string[], next: Rating[]): void => {
    names.forEach((name, index) => {
      const old = seedRating(resolve(name));
      const progressed = next[index];
      const oldRating = muToRating(old.mu);
      const newRating = muToRating(progressed.mu);
      updates.push({
        name,
        oldRating,
        newRating,
        delta: newRating - oldRating,
        oldMu: old.mu,
        oldSigma: old.sigma,
        mu: progressed.mu,
        sigma: progressed.sigma,
      });
    });
  };

  collect(teamOneNames, rated[0]);
  collect(teamTwoNames, rated[1]);

  return updates;
}
