import { prisma } from "./db.server";
import { expectedScore, kFactor, computeGameUpdates, type EloUpdate } from "./elo";

const DEFAULT_RATING = 1000;

interface TeamSnapshot {
  team: string;
  players: { name: string; order: number }[];
}

/**
 * Process a single game history entry and update player ratings.
 * Returns the ELO deltas for each player.
 */
export async function processGame(
  eventId: string,
  historyId: string,
  teamsSnapshot: TeamSnapshot[],
  scoreOne: number,
  scoreTwo: number,
): Promise<EloUpdate[]> {
  if (teamsSnapshot.length !== 2) return [];

  const teamOnePlayers = teamsSnapshot[0].players.map((p) => p.name);
  const teamTwoPlayers = teamsSnapshot[1].players.map((p) => p.name);
  const allNames = [...teamOnePlayers, ...teamTwoPlayers];

  // Get or create ratings for all players
  const ratings = await Promise.all(
    allNames.map((name) =>
      prisma.playerRating.upsert({
        where: { eventId_name: { eventId, name } },
        create: { eventId, name, rating: DEFAULT_RATING },
        update: {},
      }),
    ),
  );
  const ratingMap = new Map(ratings.map((r) => [r.name, r]));

  // Calculate team average ELOs
  const avgElo = (names: string[]) =>
    names.reduce((sum, n) => sum + (ratingMap.get(n)?.rating ?? DEFAULT_RATING), 0) / names.length;

  const teamOneElo = avgElo(teamOnePlayers);
  const teamTwoElo = avgElo(teamTwoPlayers);

  // Determine outcome: 1 = team one wins, 0.5 = draw, 0 = team one loses
  const outcome = scoreOne > scoreTwo ? 1 : scoreOne < scoreTwo ? 0 : 0.5;

  const updates: EloUpdate[] = [];

  // Update each player
  for (const name of allNames) {
    const r = ratingMap.get(name)!;
    const isTeamOne = teamOnePlayers.includes(name);
    const playerOutcome = isTeamOne ? outcome : 1 - outcome;
    const opponentElo = isTeamOne ? teamTwoElo : teamOneElo;
    const expected = expectedScore(r.rating, opponentElo);
    const k = kFactor(r.gamesPlayed);
    const delta = Math.round(k * (playerOutcome - expected));
    const newRating = r.rating + delta;

    const isWin = playerOutcome === 1;
    const isDraw = playerOutcome === 0.5;

    await prisma.playerRating.update({
      where: { id: r.id },
      data: {
        rating: newRating,
        gamesPlayed: { increment: 1 },
        wins: { increment: isWin ? 1 : 0 },
        draws: { increment: isDraw ? 1 : 0 },
        losses: { increment: !isWin && !isDraw ? 1 : 0 },
      },
    });

    updates.push({ name, oldRating: r.rating, newRating, delta });
  }

  // Mark history entry as processed
  await prisma.gameHistory.update({
    where: { id: historyId },
    data: { eloProcessed: true },
  });

  return updates;
}

/**
 * Recalculate all ratings for an event from scratch.
 * Resets all ratings and reprocesses history in chronological order.
 * Preserves manually-set initial ratings (initialRating field).
 */
export async function recalculateAllRatings(eventId: string): Promise<number> {
  // Capture manually-set initial ratings before wiping
  const existingRatings = await prisma.playerRating.findMany({
    where: { eventId, initialRating: { not: null } },
    select: { name: true, initialRating: true },
  });
  const initialRatings = new Map(existingRatings.map((r) => [r.name, r.initialRating!]));

  // Reset all ratings and processed flags
  await prisma.$transaction([
    prisma.playerRating.deleteMany({ where: { eventId } }),
    prisma.gameHistory.updateMany({
      where: { eventId },
      data: { eloProcessed: false },
    }),
  ]);

  // Re-create ratings for players that had manual initial ratings
  for (const [name, initial] of initialRatings) {
    await prisma.playerRating.create({
      data: { eventId, name, rating: initial, initialRating: initial },
    });
  }

  // Process all played games with scores in chronological order
  const games = await prisma.gameHistory.findMany({
    where: {
      eventId,
      status: "played",
      scoreOne: { not: null },
      scoreTwo: { not: null },
      teamsSnapshot: { not: null },
    },
    orderBy: { dateTime: "asc" },
  });

  let processed = 0;
  for (const game of games) {
    const snapshot: TeamSnapshot[] = JSON.parse(game.teamsSnapshot!);
    await processGame(eventId, game.id, snapshot, game.scoreOne!, game.scoreTwo!);
    processed++;
  }

  return processed;
}

/**
 * Balance teams using ELO ratings.
 * Uses greedy balancing: sort by rating desc, then snake-draft to minimize difference.
 */
export function balanceTeams(
  players: { name: string; rating: number }[],
  teamNames: [string, string],
): { team: string; players: { name: string; order: number }[] }[] {
  // Sort by rating descending
  const sorted = [...players].sort((a, b) => b.rating - a.rating);

  const teams: { team: string; players: { name: string; order: number }[] }[] = [
    { team: teamNames[0], players: [] },
    { team: teamNames[1], players: [] },
  ];
  const totals = [0, 0];

  // Snake draft: assign each player to the team with lower total ELO
  for (const player of sorted) {
    const target = totals[0] <= totals[1] ? 0 : 1;
    teams[target].players.push({ name: player.name, order: teams[target].players.length });
    totals[target] += player.rating;
  }

  return teams;
}
