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
  type Side,
  type StakesLineupPlayer,
  type StakesPlayerInput,
  type StakesCrewInput,
  type StakesPreviewData,
} from "./stakesPreview";

/** Max eligible Games a Season counts as rounds (pilot format). */
export const SEASON_ROUNDS = 8;

export interface StakesLineup {
  teamOne: string[];
  teamTwo: string[];
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
  viewerName: string,
): Promise<StakesPreviewData | null> {
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

  // Withdrawal stops Crew contribution from the withdrawal instant onward
  // (pilot: withdrawal stops contributing but not attending), so a withdrawn
  // member still in the drawn lineup earns no Crew point.
  const withdrawnNames = new Set(
    season.memberships
      .filter((m) => m.withdrawnAt !== null && m.withdrawnAt <= gameDateTime)
      .map((m) => m.eventPlayer.name),
  );

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
    const crewId = membership && !withdrawnNames.has(p.name) ? membership.crewId : null;
    return {
      name: p.name,
      skill: skill.get(p.name)?.rating ?? 1000,
      hidden: p.hidden,
      display: p.display,
      gamesThisSeason: p.games,
      seeded: p.seeded ?? false,
      provisional: p.provisional,
      crewId,
      crewName: crewId ? membership?.crew?.name ?? null : null,
    };
  });

  const membershipByName = new Map(season.memberships.map((m) => [m.eventPlayer.name, m]));
  const toLineupPlayer = (side: Side, names: string[]): StakesLineupPlayer[] =>
    names.map((name) => {
      const m = membershipByName.get(name);
      const crewId = m && !withdrawnNames.has(name) ? m.crewId : null;
      return {
        name,
        side,
        crewId,
        crewName: crewId ? m?.crew?.name ?? null : null,
        participant: !!m,
      };
    });
  const lineupPlayers = [
    ...toLineupPlayer("teamOne", lineup.teamOne),
    ...toLineupPlayer("teamTwo", lineup.teamTwo),
  ];
  const playingCrewIds = new Set(lineupPlayers.map((p) => p.crewId).filter((id): id is string => !!id));

  // Include a Crew only if the real standings table would show it (has a
  // represented round) or it is fielding someone now — so projected places
  // never interleave with crews the Season table drops.
  const crews: StakesCrewInput[] = [...crewNameById.entries()]
    .filter(([crewId]) => playingCrewIds.has(crewId) || (standings.find((c) => c.crewId === crewId)?.gameScores.length ?? 0) > 0)
    .map(([crewId, name]) => ({
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

  // Per-player Rank movement is private: only the viewer's own scenario keeps
  // it; every other lineup player's row keeps only the public Crew + points.
  const privateScenarios = scenarios.map((s) => ({
    ...s,
    players: s.players.map((p) =>
      p.name === viewerName
        ? p
        : { ...p, rpDelta: 0, passed: 0, tierAfter: p.tierBefore, positionAfter: p.positionBefore },
    ),
  }));

  return {
    seasonId: season.id,
    seasonName: season.name,
    rankEnabled: event?.rankEnabled ?? true,
    roundAvailable,
    roundsCounted,
    viewerName,
    lineup: lineupPlayers,
    scenarios: privateScenarios,
  };
}
