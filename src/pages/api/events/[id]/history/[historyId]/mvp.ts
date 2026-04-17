import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession } from "../../../../../../lib/auth.helpers.server";
import { MVP_VOTING_WINDOW_DAYS } from "../../../../../../lib/mvp.constants";

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
  const withinWindow = daysSinceCreation <= MVP_VOTING_WINDOW_DAYS;

  const newerGame = await prisma.gameHistory.findFirst({
    where: {
      eventId: params.id,
      dateTime: { gt: history.dateTime },
      status: "played",
    },
    select: { id: true },
  });
  const isLatestGame = !newerGame;
  const isVotingOpen = gameEnded && isLatestGame && withinWindow && history.status === "played" && (event.mvpEnabled ?? true);

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
    // First try: find player linked by userId
    let playerIds: string[];
    const userPlayers = await prisma.player.findMany({
      where: { eventId: params.id, userId: session.user.id },
      select: { id: true },
    });
    playerIds = userPlayers.map((p) => p.id);

    // Fallback: match by name in teamsSnapshot (same logic as mvp-vote.ts)
    if (playerIds.length === 0 && session.user.name && history.teamsSnapshot) {
      const teams = JSON.parse(history.teamsSnapshot) as Array<{ team: string; players: Array<{ name: string }> }>;
      const allSnapshotPlayers = teams.flatMap((t) => t.players);
      const nameMatch = allSnapshotPlayers.find(
        (p) => p.name.toLowerCase() === (session.user!.name ?? "").toLowerCase(),
      );
      if (nameMatch) {
        const playerByName = await prisma.player.findFirst({
          where: { eventId: params.id, name: nameMatch.name },
          select: { id: true },
        });
        if (playerByName) playerIds = [playerByName.id];
      }
    }

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
    votes: votes.map((v: { voterName: string; votedForName: string }) => ({
      voterName: v.voterName,
      votedForName: v.votedForName,
    })),
    isVotingOpen,
    hasVoted,
    totalVotes: votes.length,
  });
};
