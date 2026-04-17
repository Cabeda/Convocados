import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession } from "../../../../../../lib/auth.helpers.server";

const VOTING_WINDOW_DAYS = 7;

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Event not found." }, { status: 404 });

  const history = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  if (!history) return Response.json({ error: "Game not found." }, { status: 404 });

  // Compute isVotingOpen
  const gameEndTime = new Date(event.dateTime.getTime() + (event.durationMinutes ?? 60) * 60_000);
  const gameEnded = gameEndTime <= new Date();
  const daysSinceCreation = (Date.now() - history.createdAt.getTime()) / 86400_000;
  const withinWindow = daysSinceCreation <= VOTING_WINDOW_DAYS;

  const newerGame = await prisma.gameHistory.findFirst({
    where: {
      eventId: params.id,
      dateTime: { gt: history.dateTime },
      status: "played",
    },
    select: { id: true },
  });
  const isLatestGame = !newerGame;
  const isVotingOpen = gameEnded && isLatestGame && withinWindow && history.status === "played";

  // Get all votes for this game
  const votes = await prisma.mvpVote.findMany({
    where: { gameHistoryId: history.id },
  });

  // Tally votes
  let mvp: Array<{ playerId: string; playerName: string; voteCount: number }> | null = null;
  if (votes.length > 0) {
    const tally = new Map<string, { playerId: string; playerName: string; count: number }>();
    for (const v of votes) {
      const existing = tally.get(v.votedForPlayerId);
      if (existing) {
        existing.count++;
      } else {
        tally.set(v.votedForPlayerId, {
          playerId: v.votedForPlayerId,
          playerName: v.votedForName,
          count: 1,
        });
      }
    }
    const maxVotes = Math.max(...Array.from(tally.values()).map((t) => t.count));
    mvp = Array.from(tally.values())
      .filter((t) => t.count === maxVotes)
      .map((t) => ({ playerId: t.playerId, playerName: t.playerName, voteCount: t.count }));
  }

  // Check if authenticated user has voted
  let hasVoted: boolean | null = null;
  const session = await getSession(request);
  if (session?.user?.id) {
    const userPlayers = await prisma.player.findMany({
      where: { eventId: params.id, userId: session.user.id },
      select: { id: true },
    });
    const playerIds = userPlayers.map((p) => p.id);
    if (playerIds.length > 0) {
      const existingVote = await prisma.mvpVote.findFirst({
        where: {
          gameHistoryId: history.id,
          voterPlayerId: { in: playerIds },
        },
      });
      hasVoted = !!existingVote;
    } else {
      hasVoted = false;
    }
  }

  return Response.json({
    mvp,
    votes: votes.map((v) => ({
      voterName: v.voterName,
      votedForName: v.votedForName,
    })),
    isVotingOpen,
    hasVoted,
    totalVotes: votes.length,
  });
};
