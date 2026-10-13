/**
 * Server assembly for the Stakes Preview (ADR 0050).
 *
 * Resolves the Event's active Season covering the next unscored Game, replays
 * the Season's Rank and Crew standings, and projects the three side results via
 * the pure `projectStakes` module. Returns whole projections — never raw Skill
 * Rating — so the preview honours the Rank-transparency rule.
 */
import { prisma } from "./db.server";
import { getLifetimeSkill } from "./skill.server";
import {
  calculateLeaderboard,
  filterLeaderboardGames,
  type LeaderboardGame,
  type SeasonMember,
} from "./leaderboard";
import { seasonCompetitiveWindow } from "./seasonSetup.server";
import { toLeaderboardGame } from "./gameSnapshot";
import { deriveSeasonRank } from "./seasonRank.server";
import { provisionalGames } from "./seasonRank";
import {
  projectStakes,
  type StakesScenario,
  type StakesPlayerInput,
  type StakesCrewInput,
} from "./stakesPreview";

/** Max eligible Games a Season counts as rounds (pilot format). */
export const SEASON_ROUNDS = 8;

export interface StakesLineup {
  teamOne: string[];
  teamTwo: string[];
}

export interface StakesPreviewPayload {
  eventId: string;
  seasonId: string;
  seasonName: string;
  rankEnabled: boolean;
  roundAvailable: boolean;
  roundsCounted: number;
  /** Empty when the Season has no available round left. */
  scenarios: StakesScenario[];
}

/**
 * The active Season whose window contains `gameDateTime`, if any. Shared by the
 * endpoint's participant gate and the projection so the two never disagree.
 */
export function activeSeasonWhere(eventId: string, gameDateTime: Date) {
  return {
    eventId,
    status: "active" as const,
    registrationOpensAt: { lte: gameDateTime },
    registrationClosesAt: { gte: gameDateTime },
  };
}

const seasonSelect = {
  id: true,
  name: true,
  eventId: true,
  status: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  completedAt: true,
  cancelledAt: true,
  memberships: { include: { eventPlayer: true, crew: true } },
} as const;

/**
 * Project the Season outcome of the Game at `gameDateTime` for the given
 * lineups. Returns null when the Event has no active Season covering the Game.
 */
export async function getStakesPreview(
  eventId: string,
  gameDateTime: Date,
  lineup: StakesLineup,
): Promise<StakesPreviewPayload | null> {
  const season = await prisma.season.findFirst({
    where: activeSeasonWhere(eventId, gameDateTime),
    orderBy: { registrationOpensAt: "desc" },
    select: seasonSelect,
  });
  if (!season) return null;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { rankEnabled: true },
  });

  const { startsAt, endsAt } = seasonCompetitiveWindow(season);
  const history = await prisma.gameHistory.findMany({ where: { eventId }, orderBy: { dateTime: "asc" } });
  const allGames = history.map(toLeaderboardGame).filter((g): g is LeaderboardGame => g !== null);
  const qualifying = filterLeaderboardGames(allGames, { startsAt, endsAt });
  const roundsCounted = qualifying.length;
  const roundAvailable = roundsCounted < SEASON_ROUNDS;

  const members: SeasonMember[] = season.memberships.map((m) => ({
    membershipId: m.id,
    name: m.eventPlayer.name,
    crewId: m.crewId,
    crewName: m.crew?.name ?? null,
    withdrawnAt: m.withdrawnAt,
  }));

  const rank = await deriveSeasonRank(eventId, season.id);
  const standings = calculateLeaderboard(allGames, members, { startsAt, endsAt }).crews;

  const lineupNames = [...lineup.teamOne, ...lineup.teamTwo];
  const memberNames = season.memberships.map((m) => m.eventPlayer.name);
  const skill = await getLifetimeSkill(eventId, [...new Set([...lineupNames, ...memberNames])]);

  const crewNameById = new Map<string, string>();
  for (const m of season.memberships) {
    if (m.crewId && m.crew?.name) crewNameById.set(m.crewId, m.crew.name);
  }

  const players: StakesPlayerInput[] = (rank?.players ?? []).map((p) => {
    const membership = season.memberships.find((m) => m.eventPlayer.name === p.name);
    return {
      name: p.name,
      skill: skill.get(p.name)?.rating ?? 1000,
      hidden: p.hidden,
      display: p.display,
      gamesThisSeason: p.games,
      seeded: p.seeded,
      provisional: p.provisional,
      crewId: membership?.crewId ?? null,
      crewName: membership?.crew?.name ?? null,
    };
  });

  const crews: StakesCrewInput[] = [...crewNameById.entries()].map(([crewId, name]) => ({
    crewId,
    name,
    scores: standings.find((c) => c.crewId === crewId)?.gameScores.map((s) => s.score) ?? [],
  }));

  const scenarios = roundAvailable
    ? projectStakes({
        teamOne: { players: lineup.teamOne },
        teamTwo: { players: lineup.teamTwo },
        players,
        crews,
        edges: rank?.edges ?? [],
        provisionalWindow: provisionalGames(Math.max(roundsCounted, 1)),
      })
    : [];

  return {
    eventId,
    seasonId: season.id,
    seasonName: season.name,
    rankEnabled: event?.rankEnabled ?? true,
    roundAvailable,
    roundsCounted,
    scenarios,
  };
}
