import type { LeaderboardGame } from "./leaderboard";

/** One team as stored in a `GameHistory.teamsSnapshot`. */
export interface SnapshotTeamInput {
  team: string;
  players: Array<{ name: string }>;
}

/** The two immutable match lineups parsed from a snapshot. */
export type SnapshotTeams = [LeaderboardGame["teams"][0], LeaderboardGame["teams"][1]];

/**
 * Parse a `GameHistory.teamsSnapshot` into the two match lineups.
 *
 * GameHistory is the only immutable source of the teams that actually played —
 * live Game rows keep participants but not assignments. Returns null on null,
 * malformed, or incomplete input so callers can filter the game out.
 */
export function parseTeamsSnapshot(value: string | null): SnapshotTeams | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SnapshotTeamInput[];
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !parsed.every(
        (team) =>
          team &&
          typeof team.team === "string" &&
          team.team.trim().length > 0 &&
          Array.isArray(team.players) &&
          team.players.length > 0 &&
          team.players.every(
            (player) => player && typeof player.name === "string" && player.name.trim().length > 0,
          ),
      )
    ) {
      return null;
    }
    const teams = parsed.map((team) => ({
      name: team.team,
      players: team.players.map((player) => player.name),
    }));
    return teams as SnapshotTeams;
  } catch {
    return null;
  }
}

/** The GameHistory row shape a leaderboard/rank replay needs. */
export interface SnapshotGameRow {
  id: string;
  dateTime: Date;
  status: string;
  isFriendly: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teamsSnapshot: string | null;
}

/** Map a GameHistory row to a replay game, or null when it has no usable lineups. */
export function toLeaderboardGame(row: SnapshotGameRow): LeaderboardGame | null {
  const teams = parseTeamsSnapshot(row.teamsSnapshot);
  return teams
    ? {
        id: row.id,
        dateTime: row.dateTime,
        status: row.status,
        isFriendly: row.isFriendly,
        scoreOne: row.scoreOne,
        scoreTwo: row.scoreTwo,
        teams,
      }
    : null;
}
