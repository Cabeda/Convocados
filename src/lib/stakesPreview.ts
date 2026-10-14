/**
 * Stakes Preview — pure projection of an unplayed Game's Season outcome.
 * See ADR 0050 and the "Stakes Preview" glossary entry.
 *
 * No database dependency: the server assembles the inputs (Skill via the
 * canonical seam, current Rank ladder, Crew standings) and this module derives,
 * for each of the three side results, every lineup player's Season
 * Contribution, each Crew's resulting Crew Round Score, and the movement in the
 * Rank ladder and the Crew standings.
 */

import { displayRank, rankDelta, tierOf } from "./seasonRank";

export type MatchOutcome = "teamOne" | "draw" | "teamTwo";
export type Side = "teamOne" | "teamTwo";

/** The three side results, always projected in this order. */
export const OUTCOMES: readonly MatchOutcome[] = ["teamOne", "draw", "teamTwo"];

export interface StakesPlayerInput {
  name: string;
  /** Skill Rating (hidden; used only for the Rank projection, never returned). */
  skill: number;
  /** Hidden, signed Season Rank. */
  hidden: number;
  /** Current displayed Rank. */
  display: number;
  gamesThisSeason: number;
  seeded: boolean;
  provisional: boolean;
  crewId: string | null;
  crewName: string | null;
}

export interface StakesCrewInput {
  crewId: string;
  name: string;
  /** Raw per-round scores represented so far (may be fractional means). */
  scores: number[];
}

export interface StakesSideInput {
  players: string[];
}

export interface StakesInput {
  teamOne: StakesSideInput;
  teamTwo: StakesSideInput;
  players: StakesPlayerInput[];
  crews: StakesCrewInput[];
  edges: number[];
  provisionalWindow: number;
}

export interface PlayerProjection {
  name: string;
  side: Side;
  crewId: string | null;
  crewName: string | null;
  /** Season Contribution: 3 (win), 1 (draw), 0 (loss). */
  contribution: number;
  rpDelta: number;
  rankBefore: number;
  rankAfter: number;
  tierBefore: number;
  tierAfter: number;
  provisional: boolean;
  positionBefore: number;
  positionAfter: number;
  /** Places climbed on the Rank ladder (positive = up). */
  passed: number;
}

export interface CrewProjection {
  crewId: string;
  name: string;
  /** Displayed round score, rounded half-up to whole points. */
  roundScore: number;
  membersInLineup: number;
  positionBefore: number;
  positionAfter: number;
  /** Places climbed in the standings (positive = up). */
  passed: number;
}

export interface StakesScenario {
  outcome: MatchOutcome;
  players: PlayerProjection[];
  crews: CrewProjection[];
}

/** One lineup player's Crew association, present even with no scenarios left. */
export interface StakesLineupPlayer {
  name: string;
  side: Side;
  crewId: string | null;
  crewName: string | null;
  /** A Season participant (has Rank; may be a free agent with no Crew). */
  participant: boolean;
}

/** Everything the client needs to render the Stakes Preview surfaces. */
export interface StakesPreviewData {
  seasonId: string;
  seasonName: string;
  rankEnabled: boolean;
  roundAvailable: boolean;
  roundsCounted: number;
  /** The viewer's lineup name; per-player Rank movement is theirs alone. */
  viewerName: string;
  lineup: StakesLineupPlayer[];
  /** Empty when the Season has no available round left. */
  scenarios: StakesScenario[];
}

/** Crew per lineup player name (null = free agent / not a Season participant). */
export function crewMapFromLineup(
  lineup: readonly StakesLineupPlayer[],
): Record<string, { crewId: string; crewName: string } | null> {
  const map: Record<string, { crewId: string; crewName: string } | null> = {};
  for (const p of lineup) {
    if (!p.participant) continue; // not a Season participant — no chip at all
    map[p.name] = p.crewId && p.crewName ? { crewId: p.crewId, crewName: p.crewName } : null;
  }
  return map;
}

/**
 * Season Contribution per player for the given lineups and outcome. Depends only
 * on which side a player is on, so the client can derive it live while dragging
 * without the hidden Skill Rating.
 */
export function liveContribution(
  teamOne: readonly string[],
  teamTwo: readonly string[],
  outcome: MatchOutcome,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const name of teamOne) map[name] = contributionFor("teamOne", outcome);
  for (const name of teamTwo) map[name] = contributionFor("teamTwo", outcome);
  return map;
}

/** A Crew's round score (mean of its lineup members) over the given roster. */
export function liveCrewRoundScore(
  roster: ReadonlyArray<{ name: string; side: Side }>,
  crewByPlayer: Record<string, { crewId: string; crewName: string } | null>,
  contributionByPlayer: Record<string, number>,
): Record<string, number> {
  const points = new Map<string, number[]>();
  for (const { name } of roster) {
    const crew = crewByPlayer[name];
    if (!crew) continue;
    const list = points.get(crew.crewId) ?? [];
    list.push(contributionByPlayer[name] ?? 0);
    points.set(crew.crewId, list);
  }
  const map: Record<string, number> = {};
  for (const [crewId, list] of points) {
    map[crewId] = list.reduce((sum, value) => sum + value, 0) / list.length;
  }
  return map;
}

/** Round tournament points to whole numbers, half-up. */
export function roundPoints(value: number): number {
  return Math.round(value);
}

/** Season Contribution for a player on `side` under a scenario outcome. */
export function contributionFor(side: Side, outcome: MatchOutcome): number {
  if (outcome === "draw") return 1;
  return outcome === side ? 3 : 0;
}

/** Sum of a Crew's best six round scores (raw). */
export function bestSix(scores: readonly number[]): number {
  return [...scores]
    .sort((a, b) => b - a)
    .slice(0, 6)
    .reduce((sum, value) => sum + value, 0);
}

function total(scores: readonly number[]): number {
  return scores.reduce((sum, value) => sum + value, 0);
}

function sideOutcome(side: Side, outcome: MatchOutcome): number {
  if (outcome === "draw") return 0.5;
  return outcome === side ? 1 : 0;
}

function averageSkill(names: readonly string[], byName: Map<string, StakesPlayerInput>): number {
  if (names.length === 0) return 1000;
  return names.reduce((sum, name) => sum + (byName.get(name)?.skill ?? 1000), 0) / names.length;
}

/** 1-based ladder positions, best displayed Rank first, ties by name. */
function playerPositions(rows: Array<{ name: string; display: number }>): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.display - a.display || a.name.localeCompare(b.name));
  return new Map(sorted.map((row, index) => [row.name, index + 1]));
}

/** 1-based standings positions, best-six first, then all-games total, then name. */
function crewPositions(
  rows: Array<{ crewId: string; name: string; scores: number[] }>,
): Map<string, number> {
  const sorted = [...rows].sort(
    (a, b) =>
      bestSix(b.scores) - bestSix(a.scores) ||
      total(b.scores) - total(a.scores) ||
      a.name.localeCompare(b.name),
  );
  return new Map(sorted.map((row, index) => [row.crewId, index + 1]));
}

/** Project the Season outcome of an unplayed Game for all three side results. */
export function projectStakes(input: StakesInput): StakesScenario[] {
  const byName = new Map(input.players.map((p) => [p.name, p]));

  const positionBefore = playerPositions(
    input.players.map((p) => ({ name: p.name, display: p.display })),
  );
  const crewPositionBefore = crewPositions(
    input.crews.map((c) => ({ crewId: c.crewId, name: c.name, scores: c.scores })),
  );

  const teamOneAvg = averageSkill(input.teamOne.players, byName);
  const teamTwoAvg = averageSkill(input.teamTwo.players, byName);

  const lineup: Array<[Side, string[]]> = [
    ["teamOne", input.teamOne.players],
    ["teamTwo", input.teamTwo.players],
  ];

  return OUTCOMES.map((outcome) => {
    const rows = lineup.flatMap(([side, names]) => {
      const opponentAvg = side === "teamOne" ? teamTwoAvg : teamOneAvg;
      return names.flatMap((name) => {
        const p = byName.get(name);
        if (!p) return []; // lineup guest — not a Season participant
        const rpDelta = rankDelta(p.skill, opponentAvg, sideOutcome(side, outcome), {
          seasonGames: p.gamesThisSeason,
          seeded: p.seeded,
          provisionalWindow: input.provisionalWindow,
        });
        return [{ p, side, contribution: contributionFor(side, outcome), rpDelta, rankAfter: displayRank(p.hidden + rpDelta) }];
      });
    });

    const positionAfter = playerPositions(
      input.players.map((p) => {
        const row = rows.find((r) => r.p.name === p.name);
        return { name: p.name, display: row ? row.rankAfter : p.display };
      }),
    );

    const players: PlayerProjection[] = rows.map((r) => {
      const before = positionBefore.get(r.p.name) ?? 0;
      const after = positionAfter.get(r.p.name) ?? 0;
      return {
        name: r.p.name,
        side: r.side,
        crewId: r.p.crewId,
        crewName: r.p.crewName,
        contribution: r.contribution,
        rpDelta: r.rpDelta,
        rankBefore: r.p.display,
        rankAfter: r.rankAfter,
        tierBefore: tierOf(r.p.display, input.edges),
        tierAfter: tierOf(r.rankAfter, input.edges),
        provisional: r.p.provisional,
        positionBefore: before,
        positionAfter: after,
        passed: before - after,
      };
    });

    const crewPoints = new Map<string, number[]>();
    for (const r of rows) {
      if (!r.p.crewId) continue;
      const list = crewPoints.get(r.p.crewId) ?? [];
      list.push(r.contribution);
      crewPoints.set(r.p.crewId, list);
    }
    const roundScoreOf = (crewId: string): number => {
      const list = crewPoints.get(crewId) ?? [];
      return list.length ? total(list) / list.length : 0;
    };

    const crewPositionAfter = crewPositions(
      input.crews.map((c) => ({
        crewId: c.crewId,
        name: c.name,
        scores: [...c.scores, roundScoreOf(c.crewId)],
      })),
    );

    const crews: CrewProjection[] = input.crews.map((c) => {
      const before = crewPositionBefore.get(c.crewId) ?? 0;
      const after = crewPositionAfter.get(c.crewId) ?? 0;
      return {
        crewId: c.crewId,
        name: c.name,
        roundScore: roundPoints(roundScoreOf(c.crewId)),
        membersInLineup: (crewPoints.get(c.crewId) ?? []).length,
        positionBefore: before,
        positionAfter: after,
        passed: before - after,
      };
    });

    return { outcome, players, crews };
  });
}
