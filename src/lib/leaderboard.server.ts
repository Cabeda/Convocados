import { prisma } from "./db.server";
import { checkOwnership } from "./auth.helpers.server";
import { calculateLeaderboard, filterLeaderboardGames, type LeaderboardGame, type SeasonMember } from "./leaderboard";

export interface LeaderboardScope {
  type: "event" | "season";
  seasonId: string | null;
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface LeaderboardPayload {
  scope: LeaderboardScope;
  players: ReturnType<typeof calculateLeaderboard>["players"];
  crews: ReturnType<typeof calculateLeaderboard>["crews"];
  gamesCount: number;
  hidden?: boolean;
}

interface SnapshotTeam {
  team: string;
  players: Array<{ name: string }>;
}

function parseTeamsSnapshot(value: string | null): [LeaderboardGame["teams"][0], LeaderboardGame["teams"][1]] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SnapshotTeam[];
    if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every((team) => team && typeof team.team === "string" && team.team.trim().length > 0 && Array.isArray(team.players) && team.players.length > 0 && team.players.every((player) => player && typeof player.name === "string" && player.name.trim().length > 0))) return null;
    const teams = parsed.map((team) => ({
      name: team.team,
      players: team.players.map((player) => player.name),
    }));
    return teams as [LeaderboardGame["teams"][0], LeaderboardGame["teams"][1]];
  } catch {
    return null;
  }
}

function toLeaderboardGame(row: {
  id: string;
  dateTime: Date;
  status: string;
  isFriendly: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teamsSnapshot: string | null;
}): LeaderboardGame | null {
  const teams = parseTeamsSnapshot(row.teamsSnapshot);
  return teams ? { id: row.id, dateTime: row.dateTime, status: row.status, isFriendly: row.isFriendly, scoreOne: row.scoreOne, scoreTwo: row.scoreTwo, teams } : null;
}

function toIso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

const EMPTY_SCOPE: LeaderboardScope = { type: "event", seasonId: null, name: null, startsAt: null, endsAt: null };

/**
 * Build the standings payload for an event, optionally scoped to a Season.
 * Shared by GET /history/leaderboard and the Season detail response so the
 * Season page can render standings without a second request.
 */
export async function computeLeaderboardPayload(
  eventId: string,
  requestedSeasonId: string | null,
  request: Request,
): Promise<LeaderboardPayload | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, ownerId: true, showCompetitiveData: true } });
  if (!event) return null;

  if (!event.showCompetitiveData) {
    const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
    if (!isOwner && !isAdmin) return { hidden: true, scope: EMPTY_SCOPE, players: [], crews: [], gamesCount: 0 };
  }

  const [history, seasons] = await Promise.all([
    prisma.gameHistory.findMany({ where: { eventId }, orderBy: { dateTime: "asc" } }),
    prisma.season.findMany({ where: { eventId, status: { not: "cancelled" } }, include: { memberships: { include: { eventPlayer: true, crew: true } } }, orderBy: { registrationOpensAt: "desc" } }),
  ]);

  // GameHistory is the only immutable source of the teams that actually played.
  // Live Game rows keep participants but not team assignments, so using the
  // event's current teamResults would silently rewrite older matches.
  const allGames = history
    .map(toLeaderboardGame)
    .filter((game): game is LeaderboardGame => game !== null)
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
  const eligibleGames = filterLeaderboardGames(allGames);
  const latestGameTime = eligibleGames.length ? new Date(eligibleGames[eligibleGames.length - 1].dateTime).getTime() : null;

  const selectedSeason = requestedSeasonId && requestedSeasonId !== "all"
    ? seasons.find((season) => season.id === requestedSeasonId) ?? null
    : requestedSeasonId === "all"
      ? null
      : seasons.find((season) => {
          const startsAt = season.registrationOpensAt.getTime();
          return latestGameTime !== null && startsAt <= latestGameTime;
        }) ?? null;

  if (requestedSeasonId && requestedSeasonId !== "all" && !selectedSeason) {
    return null;
  }

  const seasonMembers: SeasonMember[] = selectedSeason
    ? selectedSeason.memberships.map((membership) => ({
        membershipId: membership.id,
        name: membership.eventPlayer.name,
        crewId: membership.crewId,
        crewName: membership.crew?.name ?? null,
        joinedAt: membership.joinedAt,
        withdrawnAt: membership.withdrawnAt,
      }))
    : [];
  // The season period is the registration window: editing it recomputes the
  // standings live, adding and removing period games automatically. Completion
  // still caps the window for seasons ended early.
  const startsAt = selectedSeason?.registrationOpensAt ?? null;
  const completedEndsAt = selectedSeason?.completedAt ?? selectedSeason?.cancelledAt ?? null;
  const closesAt = selectedSeason?.registrationClosesAt ?? null;
  const endsAt = completedEndsAt && closesAt && completedEndsAt < closesAt ? completedEndsAt : closesAt;
  // Members enrolled after the season period closed (e.g. a retroactive season
  // set up after the games) count for the whole period — see isMemberEffective.
  const seasonEndsAt = selectedSeason?.registrationClosesAt ?? null;
  const standings = calculateLeaderboard(allGames, selectedSeason ? seasonMembers : undefined, { startsAt, endsAt, seasonEndsAt });

  return {
    scope: {
      type: selectedSeason ? "season" : "event",
      seasonId: selectedSeason?.id ?? null,
      name: selectedSeason?.name ?? null,
      startsAt: toIso(startsAt),
      endsAt: toIso(endsAt),
    },
    ...standings,
  };
}
