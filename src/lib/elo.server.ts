import { prisma } from "./db.server";
import {
  computeSkillUpdates,
  DEFAULT_MU,
  DEFAULT_RATING,
  DEFAULT_SIGMA,
  ratingToMu,
  SCALE,
  type SkillUpdate,
} from "./skill";
import { MVP_ELO_BONUS } from "./mvp.constants";

interface TeamSnapshot {
  team: string;
  players: { name: string; order: number }[];
}

/**
 * Process a single game history entry and update player ratings.
 *
 * The scalar `PlayerRating.rating` (the balancing input, a 1000-centred number)
 * is a projection of an OpenSkill posterior `(mu, sigma)` — see src/lib/skill.ts.
 * Returns the rating deltas for each player. Skips friendly games — they don't
 * affect ratings.
 */
export async function processGame(
  eventId: string,
  historyId: string,
  teamsSnapshot: TeamSnapshot[],
  scoreOne: number,
  scoreTwo: number,
): Promise<SkillUpdate[]> {
  // Defensive: never apply ratings to a friendly game, even if a caller forgets.
  const entry = await prisma.gameHistory.findUnique({
    where: { id: historyId },
    select: { isFriendly: true, eloProcessed: true },
  });
  if (entry?.isFriendly || entry?.eloProcessed) return [];
  if (teamsSnapshot.length !== 2) return [];

  const teamOnePlayers = teamsSnapshot[0].players.map((p) => p.name);
  const teamTwoPlayers = teamsSnapshot[1].players.map((p) => p.name);
  const allNames = [...teamOnePlayers, ...teamTwoPlayers];

  // Get or create the OpenSkill posterior for all players.
  const ratings = await Promise.all(
    allNames.map((name) =>
      prisma.playerRating.upsert({
        where: { eventId_name: { eventId, name } },
        create: {
          eventId,
          name,
          rating: DEFAULT_RATING,
          ratingMu: DEFAULT_MU,
          ratingSigma: DEFAULT_SIGMA,
        },
        update: {},
      }),
    ),
  );
  const ratingMap = new Map(ratings.map((r) => [r.name, r]));

  // Outcome: 1 = team one wins, 0.5 = draw, 0 = team one loses.
  const outcome = scoreOne > scoreTwo ? 1 : scoreOne < scoreTwo ? 0 : 0.5;

  const updates = computeSkillUpdates(
    ratings.map((r) => ({
      name: r.name,
      rating: r.rating,
      gamesPlayed: r.gamesPlayed,
      mu: r.ratingMu ?? undefined,
      sigma: r.ratingSigma ?? undefined,
    })),
    teamsSnapshot,
    scoreOne,
    scoreTwo,
  );

  for (const update of updates) {
    const r = ratingMap.get(update.name);
    if (!r) continue;
    const isTeamOne = teamOnePlayers.includes(update.name);
    const playerOutcome = isTeamOne ? outcome : 1 - outcome;
    const isWin = playerOutcome === 1;
    const isDraw = playerOutcome === 0.5;

    await prisma.playerRating.update({
      where: { id: r.id },
      data: {
        rating: update.newRating,
        ratingMu: update.mu,
        ratingSigma: update.sigma,
        gamesPlayed: { increment: 1 },
        wins: { increment: isWin ? 1 : 0 },
        draws: { increment: isDraw ? 1 : 0 },
        losses: { increment: !isWin && !isDraw ? 1 : 0 },
      },
    });

    // EventPlayer caches the rating as an MCP/crew fallback — keep it in sync
    // (rows may not exist yet, so an update-only mirror never creates one).
    await prisma.eventPlayer.updateMany({
      where: { eventId, name: update.name },
      data: { rating: update.newRating, ratingMu: update.mu, ratingSigma: update.sigma },
    });
  }

  // Apply MVP rating bonus if enabled. The bonus is denominated on the scalar
  // scale, so it moves `mu` by the same amount / SCALE to keep the projection
  // exact.
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { mvpEloEnabled: true },
  });
  if (event?.mvpEloEnabled) {
    const votes = await prisma.mvpVote.findMany({
      where: { gameHistoryId: historyId },
      select: { votedForName: true },
    });
    if (votes.length > 0) {
      const tally = new Map<string, number>();
      for (const v of votes) {
        tally.set(v.votedForName, (tally.get(v.votedForName) ?? 0) + 1);
      }
      const maxVotes = Math.max(...tally.values());
      const mvpNames = Array.from(tally.entries())
        .filter(([, count]) => count === maxVotes)
        .map(([name]) => name);

      const bonusMu = MVP_ELO_BONUS / SCALE;
      for (const mvpName of mvpNames) {
        const existingUpdate = updates.find((u) => u.name === mvpName);
        if (existingUpdate) {
          const newRatingWithBonus = existingUpdate.newRating + MVP_ELO_BONUS;
          const newMuWithBonus = existingUpdate.mu + bonusMu;
          await prisma.playerRating.update({
            where: { eventId_name: { eventId, name: mvpName } },
            data: { rating: newRatingWithBonus, ratingMu: newMuWithBonus },
          });
          await prisma.eventPlayer.updateMany({
            where: { eventId, name: mvpName },
            data: { rating: newRatingWithBonus, ratingMu: newMuWithBonus },
          });
          existingUpdate.newRating = newRatingWithBonus;
          existingUpdate.delta += MVP_ELO_BONUS;
          existingUpdate.mu = newMuWithBonus;
        }
      }
    }
  }

  // Mark history entry as processed
  await prisma.gameHistory.update({
    where: { id: historyId },
    data: { eloProcessed: true },
  });

  // Dual-write (ADR 0016): keep the occurrence Game's flag in sync so readers
  // off Game never see an unprocessed ELO state after approval. Match by id
  // (shared-id worlds) or by the occurrence (backfill/materialise worlds).
  const hist = await prisma.gameHistory.findUnique({
    where: { id: historyId },
    select: { eventId: true, dateTime: true },
  });
  if (hist) {
    await prisma.game.updateMany({
      where: {
        OR: [{ id: historyId }, { eventId: hist.eventId, dateTime: hist.dateTime }],
      },
      data: { eloProcessed: true },
    });
  }

  return updates;
}

/**
 * Recalculate all ratings for an event from scratch.
 * Resets all ratings and replays history in chronological order through the
 * OpenSkill engine (deterministic, so idempotent).
 * Preserves manually-set initial ratings (initialRating field).
 */
export async function recalculateAllRatings(eventId: string): Promise<number> {
  // Capture manually-set initial ratings before wiping
  const existingRatings = await prisma.playerRating.findMany({
    where: { eventId, initialRating: { not: null } },
    select: { name: true, initialRating: true },
  });
  const initialRatings = new Map(
    existingRatings
      .filter((r): r is typeof r & { initialRating: number } => r.initialRating !== null)
      .map((r) => [r.name, r.initialRating])
  );

  // Reset all ratings and processed flags
  await prisma.$transaction([
    prisma.playerRating.deleteMany({ where: { eventId } }),
    prisma.gameHistory.updateMany({
      where: { eventId },
      data: { eloProcessed: false },
    }),
  ]);

  // Re-create ratings for players that had manual initial ratings, seeding the
  // OpenSkill posterior from the scalar via the inverse projection.
  for (const [name, initial] of initialRatings) {
    await prisma.playerRating.create({
      data: {
        eventId,
        name,
        rating: initial,
        ratingMu: ratingToMu(initial),
        ratingSigma: DEFAULT_SIGMA,
        initialRating: initial,
      },
    });
  }

  // Process all played, non-friendly games with scores in chronological order
  const games = await prisma.gameHistory.findMany({
    where: {
      eventId,
      status: "played",
      isFriendly: false,
      scoreOne: { not: null },
      scoreTwo: { not: null },
      teamsSnapshot: { not: null },
    },
    orderBy: { dateTime: "asc" },
  });

  let processed = 0;
  for (const game of games) {
    if (game.teamsSnapshot === null || game.scoreOne === null || game.scoreTwo === null) continue;
    const snapshot: TeamSnapshot[] = JSON.parse(game.teamsSnapshot);
    await processGame(eventId, game.id, snapshot, game.scoreOne, game.scoreTwo);
    processed++;
  }

  return processed;
}

/**
 * Balance teams using Skill Ratings.
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
  const maxPerTeam = Math.ceil(sorted.length / 2);

  // Snake draft: assign each player to the team with lower total rating,
  // but enforce a max team size so teams differ by at most 1 player.
  for (const player of sorted) {
    let target: number;
    if (teams[0].players.length >= maxPerTeam) {
      target = 1;
    } else if (teams[1].players.length >= maxPerTeam) {
      target = 0;
    } else {
      target = totals[0] <= totals[1] ? 0 : 1;
    }
    teams[target].players.push({ name: player.name, order: teams[target].players.length });
    totals[target] += player.rating;
  }

  return teams;
}
