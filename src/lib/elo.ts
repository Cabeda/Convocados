/**
 * Pure ELO calculation functions — no database dependency.
 * These are the core formulas used by the ranking system.
 */

const DEFAULT_RATING = 1000;
const K_STANDARD = 32;
const K_PROVISIONAL = 40;
const PROVISIONAL_THRESHOLD = 10;

/**
 * Calculate the expected score for a player against an opponent.
 *
 *   E = 1 / (1 + 10^((opponent - player) / 400))
 *
 * Returns a value between 0 and 1.
 * Equal ratings → 0.5, 400-point advantage → ~0.91
 */
export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

/**
 * Determine the K-factor (sensitivity) based on games played.
 *
 * - K = 40 for provisional players (< 10 games) — ratings move faster
 * - K = 32 for established players (>= 10 games)
 */
export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_THRESHOLD ? K_PROVISIONAL : K_STANDARD;
}

/**
 * Compute the rating change for a single player.
 *
 *   delta = round(K × (actual_outcome - expected_outcome))
 *
 * @param playerRating   - current ELO rating
 * @param opponentRating - opposing team's average ELO
 * @param outcome        - 1 = win, 0.5 = draw, 0 = loss
 * @param gamesPlayed    - number of games played (determines K-factor)
 */
export function computeRatingDelta(
  playerRating: number,
  opponentRating: number,
  outcome: number,
  gamesPlayed: number,
): number {
  const expected = expectedScore(playerRating, opponentRating);
  const k = kFactor(gamesPlayed);
  return Math.round(k * (outcome - expected));
}

export interface EloUpdate {
  name: string;
  oldRating: number;
  newRating: number;
  delta: number;
}

interface TeamSnapshot {
  team: string;
  players: { name: string; order: number }[];
}

interface PlayerInfo {
  name: string;
  rating: number;
  gamesPlayed: number;
}

/**
 * Compute ELO updates for all players in a game.
 *
 * 1. Calculates each team's average ELO
 * 2. Determines outcome (win/draw/loss) from scores
 * 3. Applies the ELO formula to each player individually
 *
 * Players not found in the `players` array get a default 1000 rating.
 *
 * @param players  - known player ratings
 * @param teams    - two-team snapshot with player assignments
 * @param scoreOne - team 1 score
 * @param scoreTwo - team 2 score
 */
export function computeGameUpdates(
  players: PlayerInfo[],
  teams: TeamSnapshot[],
  scoreOne: number,
  scoreTwo: number,
): EloUpdate[] {
  if (teams.length !== 2) return [];

  const ratingMap = new Map(players.map((p) => [p.name, p]));
  const getPlayer = (name: string): PlayerInfo =>
    ratingMap.get(name) ?? { name, rating: DEFAULT_RATING, gamesPlayed: 0 };

  const t1Names = teams[0].players.map((p) => p.name);
  const t2Names = teams[1].players.map((p) => p.name);

  const avgElo = (names: string[]) =>
    names.reduce((sum, n) => sum + getPlayer(n).rating, 0) / names.length;

  const teamOneElo = avgElo(t1Names);
  const teamTwoElo = avgElo(t2Names);

  // 1 = team one wins, 0.5 = draw, 0 = team one loses
  const outcome = scoreOne > scoreTwo ? 1 : scoreOne < scoreTwo ? 0 : 0.5;

  const updates: EloUpdate[] = [];

  for (const name of [...t1Names, ...t2Names]) {
    const p = getPlayer(name);
    const isTeamOne = t1Names.includes(name);
    const playerOutcome = isTeamOne ? outcome : 1 - outcome;
    const opponentElo = isTeamOne ? teamTwoElo : teamOneElo;
    const delta = computeRatingDelta(p.rating, opponentElo, playerOutcome, p.gamesPlayed);

    updates.push({
      name,
      oldRating: p.rating,
      newRating: p.rating + delta,
      delta,
    });
  }

  return updates;
}
