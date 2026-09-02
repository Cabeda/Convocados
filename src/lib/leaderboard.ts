export interface LeaderboardTeam {
  name: string;
  players: string[];
}

export interface LeaderboardGame {
  id: string;
  dateTime: Date | string;
  status: string;
  isFriendly: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teams: [LeaderboardTeam, LeaderboardTeam];
}

export interface SeasonMember {
  membershipId: string;
  name: string;
  crewId: string | null;
  crewName: string | null;
  joinedAt: Date | string;
  withdrawnAt: Date | string | null;
}

export interface LeaderboardOptions {
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
}

export interface PlayerStanding {
  rank: number;
  name: string;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface CrewGameScore {
  gameId: string;
  score: number;
  counted: boolean;
}

/**
 * Season-v1 Crew standing. Unlike a player row, a Crew does not hold a
 * football W/D/L record: each member scores 3/1/0 from their own match side,
 * and the Crew's per-game score is the mean of its participating members.
 * `points` is the sum of the best six per-game scores and is the value the
 * Crew ranks on. `tieBreakTotal` sums every represented game (including the
 * dropped ones) and breaks ties on an equal best-six total.
 */
export interface CrewStanding {
  rank: number;
  crewId: string;
  name: string;
  points: number;
  tieBreakTotal: number;
  roundsRepresented: number;
  roundsCounted: number;
  gameScores: CrewGameScore[];
}

const BEST_OF = 6;

export interface LeaderboardResult {
  gamesCount: number;
  players: PlayerStanding[];
  crews: CrewStanding[];
}

interface MutableStanding {
  name: string;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

interface MutableCrewStanding {
  crewId: string;
  name: string;
  gameScores: CrewGameScore[];
}

function pointsFor(ownScore: number, opponentScore: number): number {
  if (ownScore > opponentScore) return 3;
  if (ownScore === opponentScore) return 1;
  return 0;
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function timeOf(value: Date | string): number {
  return new Date(value).getTime();
}

function validDate(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const time = timeOf(value);
  return Number.isNaN(time) ? null : time;
}

function isValidScore(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 0;
}

function isMemberEffective(member: SeasonMember, dateTime: number): boolean {
  const joinedAt = validDate(member.joinedAt);
  const withdrawnAt = validDate(member.withdrawnAt);
  return (joinedAt === null || joinedAt <= dateTime) && (withdrawnAt === null || dateTime < withdrawnAt);
}

type NormalizedTeamPlayers = [Array<[string, string]>, Array<[string, string]>];

function normalizeTeamPlayers(game: LeaderboardGame): NormalizedTeamPlayers | null {
  if (!Array.isArray(game.teams) || game.teams.length !== 2) return null;
  let malformed = false;
  const teamPlayers = game.teams.map((team) => {
    const unique = new Map<string, string>();
    for (const rawName of team.players) {
      const name = rawName.trim();
      const key = normalizeName(name);
      if (!key) continue;
      if (unique.has(key)) {
        malformed = true;
        continue;
      }
      unique.set(key, name);
    }
    return [...unique.entries()];
  });
  if (malformed || teamPlayers.some((team) => team.length === 0)) return null;
  const teamOneNames = new Set(teamPlayers[0].map(([key]) => key));
  if (teamPlayers[1].some(([key]) => teamOneNames.has(key))) return null;
  return [teamPlayers[0], teamPlayers[1]];
}

function createStanding(name: string): MutableStanding {
  return { name, points: 0, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
}

function addResult(standing: MutableStanding, ownScore: number, opponentScore: number): void {
  standing.played += 1;
  standing.goalsFor += ownScore;
  standing.goalsAgainst += opponentScore;
  if (ownScore > opponentScore) {
    standing.points += 3;
    standing.wins += 1;
  } else if (ownScore === opponentScore) {
    standing.points += 1;
    standing.draws += 1;
  } else {
    standing.losses += 1;
  }
}

function compareStandings(a: MutableStanding, b: MutableStanding): number {
  return b.points - a.points
    || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
    || b.goalsFor - a.goalsFor
    || b.wins - a.wins
    || a.name.localeCompare(b.name);
}

function finalizePlayer(standing: MutableStanding, rank: number): PlayerStanding {
  return {
    rank,
    name: standing.name,
    points: standing.points,
    played: standing.played,
    wins: standing.wins,
    draws: standing.draws,
    losses: standing.losses,
    goalsFor: standing.goalsFor,
    goalsAgainst: standing.goalsAgainst,
    goalDifference: standing.goalsFor - standing.goalsAgainst,
  };
}

function finalizeCrew(standing: MutableCrewStanding, rank: number): CrewStanding {
  // Rank on the best six per-game scores; break ties on all represented games.
  const sorted = [...standing.gameScores].sort((a, b) => b.score - a.score);
  const counted = new Set(sorted.slice(0, BEST_OF).map((entry) => entry.gameId));
  const points = sorted.slice(0, BEST_OF).reduce((sum, entry) => sum + entry.score, 0);
  const tieBreakTotal = standing.gameScores.reduce((sum, entry) => sum + entry.score, 0);
  return {
    rank,
    crewId: standing.crewId,
    name: standing.name,
    points,
    tieBreakTotal,
    roundsRepresented: standing.gameScores.length,
    roundsCounted: Math.min(BEST_OF, standing.gameScores.length),
    gameScores: standing.gameScores.map((entry) => ({ ...entry, counted: counted.has(entry.gameId) })),
  };
}

function compareCrews(a: CrewStanding, b: CrewStanding): number {
  return b.points - a.points
    || b.tieBreakTotal - a.tieBreakTotal
    || a.name.localeCompare(b.name);
}

/**
 * Filter games to the ones that qualify for standings: played, non-friendly,
 * both scores valid non-negative integers, within the optional window, and
 * with two well-formed non-overlapping team lineups. Returned in chronological
 * order. Used for both scope selection and standings so they never disagree.
 */
export function filterLeaderboardGames(
  games: readonly LeaderboardGame[],
  options: LeaderboardOptions = {},
): LeaderboardGame[] {
  const startsAt = validDate(options.startsAt);
  const endsAt = validDate(options.endsAt);
  return [...games]
    .filter((game) => game.status === "played" && !game.isFriendly)
    .filter((game) => isValidScore(game.scoreOne) && isValidScore(game.scoreTwo))
    .filter((game) => {
      const dateTime = validDate(game.dateTime);
      return dateTime !== null && (startsAt === null || dateTime >= startsAt) && (endsAt === null || dateTime <= endsAt);
    })
    .filter((game) => normalizeTeamPlayers(game) !== null)
    .sort((a, b) => timeOf(a.dateTime) - timeOf(b.dateTime));
}

/**
 * Player standings use football scoring (win 3, draw 1, loss 0) aggregated
 * from immutable match snapshots. Crew standings follow season-v1: each member
 * scores from their own side, a Crew's per-game score is the mean of its
 * participating members, and the Crew total counts its best six of eight
 * eligible games. When Season members are supplied only effective members
 * contribute; otherwise every valid participant becomes a player row and no
 * Crews are produced.
 */
export function calculateLeaderboard(
  games: readonly LeaderboardGame[],
  members?: readonly SeasonMember[],
  options: LeaderboardOptions = {},
): LeaderboardResult {
  const scopedMembers = members ?? [];
  const memberByName = new Map<string, SeasonMember>();
  for (const member of scopedMembers) {
    const key = normalizeName(member.name);
    if (key && !memberByName.has(key)) memberByName.set(key, member);
  }

  const playerStandings = new Map<string, MutableStanding>();
  for (const member of scopedMembers) {
    const key = normalizeName(member.name);
    if (key && !playerStandings.has(key)) playerStandings.set(key, createStanding(member.name.trim()));
  }

  const crewStandings = new Map<string, MutableCrewStanding>();
  for (const member of scopedMembers) {
    if (!member.crewId || !member.crewName || crewStandings.has(member.crewId)) continue;
    crewStandings.set(member.crewId, { crewId: member.crewId, name: member.crewName.trim(), gameScores: [] });
  }

  const validGames = filterLeaderboardGames(games, options);
  let gamesCount = 0;
  for (const game of validGames) {
    const dateTime = timeOf(game.dateTime);
    const teamPlayers = normalizeTeamPlayers(game);
    if (!teamPlayers) continue;

    const scoreOne = game.scoreOne;
    const scoreTwo = game.scoreTwo;
    if (!isValidScore(scoreOne) || !isValidScore(scoreTwo)) continue;
    gamesCount += 1;
    // Each Crew's per-game score is the mean of its participating members'
    // own-side points (3/1/0), regardless of which side they played.
    const crewMemberPoints = new Map<string, number[]>();

    for (const [teamIndex, team] of teamPlayers.entries()) {
      const ownScore = teamIndex === 0 ? scoreOne : scoreTwo;
      const opponentScore = teamIndex === 0 ? scoreTwo : scoreOne;
      for (const [key, displayName] of team) {
        const member = memberByName.get(key);
        if (members !== undefined && (!member || !isMemberEffective(member, dateTime))) continue;
        const standing = playerStandings.get(key) ?? createStanding(displayName);
        playerStandings.set(key, standing);
        addResult(standing, ownScore, opponentScore);
        if (member?.crewId && member.crewName && crewStandings.has(member.crewId) && isMemberEffective(member, dateTime)) {
          const points = crewMemberPoints.get(member.crewId) ?? [];
          points.push(pointsFor(ownScore, opponentScore));
          crewMemberPoints.set(member.crewId, points);
        }
      }
    }

    for (const [crewId, memberPoints] of crewMemberPoints) {
      if (memberPoints.length === 0) continue;
      const mean = memberPoints.reduce((sum, value) => sum + value, 0) / memberPoints.length;
      crewStandings.get(crewId)?.gameScores.push({ gameId: game.id, score: mean, counted: false });
    }
  }

  const players = [...playerStandings.values()].sort(compareStandings).map(finalizePlayer);
  players.forEach((player, index) => { player.rank = index + 1; });
  const crews = [...crewStandings.values()]
    .filter((standing) => standing.gameScores.length > 0)
    .map((standing) => finalizeCrew(standing, 0))
    .sort(compareCrews);
  crews.forEach((crew, index) => { crew.rank = index + 1; });

  return { gamesCount, players, crews };
}
