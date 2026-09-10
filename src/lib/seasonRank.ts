/**
 * Pure Season Rank functions — no database dependency.
 * A visible, 0-based seasonal ladder layered on top of the lifetime Skill
 * Rating (see src/lib/elo.ts). See ADR 0031 and docs/rank-ladder-spec.md.
 */

import { expectedScore } from "./elo";

export const TIER_NAMES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"] as const;

/**
 * Provisional window for unseeded players: clamp(round(0.25N), 3, 10) games.
 * `N` is the season's expected game count.
 */
export function provisionalGames(N: number): number {
  return Math.min(10, Math.max(3, Math.round(0.25 * N)));
}

export interface KRankOptions {
  /** Whether the player has a prior Season (seeded from Skill Rating). */
  seeded: boolean;
  /** Provisional window for unseeded players. */
  provisionalWindow: number;
}

/**
 * K-factor for the Rank layer. Seeded players always move at 32; unseeded
 * players move at 64 until their provisional window ends, then 32.
 */
export function kRank(seasonGames: number, { seeded, provisionalWindow }: KRankOptions): number {
  return !seeded && seasonGames < provisionalWindow ? 64 : 32;
}

/** Seed hidden Rank from Skill Rating: `max(0, skill - anchor)`. */
export function seedRank(skill: number, anchor: number): number {
  return Math.max(0, skill - anchor);
}

/** Apply a delta to the hidden Rank. */
export function applyGame(R: number, delta: number): number {
  return R + delta;
}

/** Skill-anchored soft reset between Seasons: `R + 0.5 * (seed - R)`. */
export function softReset(R: number, seed: number): number {
  return R + 0.5 * (seed - R);
}

/** Displayed Rank: rounded, floored at 0 (the hidden value may dip below). */
export function displayRank(R: number): number {
  return Math.max(0, Math.round(R));
}

/**
 * Per-game Rank delta against the opponents' average Skill Rating.
 * `outcome` is 1 (win), 0.5 (draw), or 0 (loss).
 */
export function rankDelta(
  playerSkill: number,
  opponentAvgSkill: number,
  outcome: number,
  options: KRankOptions & { seasonGames: number },
): number {
  const k = kRank(options.seasonGames, options);
  return Math.round(k * (outcome - expectedScore(playerSkill, opponentAvgSkill)));
}

/** Tier index for a displayed Rank: the last band whose edge is <= R. */
export function tierOf(R: number, edges: number[]): number {
  let band = 0;
  for (let i = 0; i < edges.length; i++) if (R >= edges[i]) band = i;
  return band;
}

/**
 * Percentile-derived (equal-count) tier edges from the established seeded
 * Rank distribution. Returns `tiers` values, the first always 0.
 */
export function tierEdges(seededRanks: number[], tiers = 6): number[] {
  const sorted = [...seededRanks].sort((a, b) => a - b);
  if (sorted.length === 0) return Array.from({ length: tiers }, () => 0);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  const edges = [0];
  for (let i = 1; i < tiers; i++) edges.push(q(i / tiers));
  return edges;
}

export interface RankGame {
  teamOne: string[];
  teamTwo: string[];
  scoreOne: number;
  scoreTwo: number;
}

export interface PlayerRank {
  name: string;
  /** Hidden, signed Rank (may go below 0). */
  hidden: number;
  /** Displayed Rank: rounded, floored at 0. */
  display: number;
  /** Tier index into TIER_NAMES. */
  tier: number;
  gamesThisSeason: number;
  deltas: number[];
}

export interface SeasonRankInput {
  games: RankGame[];
  /** Lifetime Skill Rating per player (via getLifetimeSkill). */
  skill: Record<string, number>;
  /** Starting hidden Rank per player. */
  seeds: Record<string, number>;
  /** Whether each player has a prior Season (false -> provisional fast K). */
  seeded: Record<string, boolean>;
  provisionalWindow: number;
  edges: number[];
}

/**
 * Replay one Season: apply every game in order, accumulating each player's
 * hidden Rank, then resolve display Rank and tier. Pure and deterministic.
 * Participants missing from `skill`/`seeds` default to 1000 / 0.
 */
export function computeSeasonRank(input: SeasonRankInput): Map<string, PlayerRank> {
  const { games, skill, seeds, seeded, provisionalWindow, edges } = input;
  const state = new Map<string, PlayerRank>();

  const ensure = (name: string): PlayerRank => {
    let s = state.get(name);
    if (!s) {
      s = { name, hidden: seeds[name] ?? 0, display: 0, tier: 0, gamesThisSeason: 0, deltas: [] };
      state.set(name, s);
    }
    return s;
  };

  for (const name of Object.keys(seeds)) ensure(name);
  for (const name of Object.keys(skill)) ensure(name);

  const skillOf = (n: string) => skill[n] ?? 1000;
  const avg = (names: string[]) => names.reduce((sum, n) => sum + skillOf(n), 0) / names.length;

  for (const g of games) {
    const outcome = g.scoreOne > g.scoreTwo ? 1 : g.scoreOne < g.scoreTwo ? 0 : 0.5;
    const avgOne = avg(g.teamOne);
    const avgTwo = avg(g.teamTwo);

    const apply = (names: string[], oppAvg: number, out: number) => {
      for (const n of names) {
        const p = ensure(n);
        const delta = rankDelta(skillOf(n), oppAvg, out, {
          seasonGames: p.gamesThisSeason,
          seeded: seeded[n] ?? false,
          provisionalWindow,
        });
        p.hidden = applyGame(p.hidden, delta);
        p.deltas.push(delta);
        p.gamesThisSeason += 1;
      }
    };

    apply(g.teamOne, avgTwo, outcome);
    apply(g.teamTwo, avgOne, 1 - outcome);
  }

  for (const s of state.values()) {
    s.display = displayRank(s.hidden);
    s.tier = tierOf(s.display, edges);
  }
  return state;
}
