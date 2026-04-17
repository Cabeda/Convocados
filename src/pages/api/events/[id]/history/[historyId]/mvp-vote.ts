import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";
import { MVP_VOTING_WINDOW_DAYS } from "../../../../../../lib/mvp.constants";

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  // Auth required
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  // Validate event + history
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Event not found." }, { status: 404 });

  if (!event.mvpEnabled) {
    return Response.json({ error: "MVP voting is disabled for this event." }, { status: 400 });
  }

  const history = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  if (!history) return Response.json({ error: "Game not found." }, { status: 404 });

  if (history.status !== "played") {
    return Response.json({ error: "Can only vote on played games." }, { status: 400 });
  }

  // Check voting window: game must have ended
  const gameEndTime = new Date(event.dateTime.getTime() + (event.durationMinutes ?? 60) * 60_000);
  if (gameEndTime > new Date()) {
    return Response.json({ error: "Voting is not open yet — game has not ended." }, { status: 400 });
  }

  // Check voting window: no newer game for this event
  const newerGame = await prisma.gameHistory.findFirst({
    where: {
      eventId: params.id,
      dateTime: { gt: history.dateTime },
      status: "played",
    },
    select: { id: true },
  });
  if (newerGame) {
    return Response.json({ error: "Voting is closed — a newer game has been played." }, { status: 400 });
  }

  // Check voting window: within 7 days of game creation
  const daysSinceCreation = (Date.now() - history.createdAt.getTime()) / 86400_000;
  if (daysSinceCreation > MVP_VOTING_WINDOW_DAYS) {
    return Response.json({ error: "Voting is closed — the 7-day window has expired." }, { status: 400 });
  }

  // Find the voter's player record in this event
  const voterPlayer = await prisma.player.findFirst({
    where: { eventId: params.id, userId },
  });

  // Also check teamsSnapshot for name-based participation
  let voterName = voterPlayer?.name;
  let voterPlayerId = voterPlayer?.id;

  if (!voterPlayer) {
    // Check if user's name appears in the teamsSnapshot
    const userName = session.user?.name;
    if (userName && history.teamsSnapshot) {
      const teams = JSON.parse(history.teamsSnapshot) as Array<{ team: string; players: Array<{ name: string }> }>;
      const allPlayers = teams.flatMap((t) => t.players);
      const match = allPlayers.find((p) => p.name.toLowerCase() === userName.toLowerCase());
      if (match) {
        // Find the player record by name
        const playerByName = await prisma.player.findFirst({
          where: { eventId: params.id, name: match.name },
        });
        if (playerByName) {
          voterName = playerByName.name;
          voterPlayerId = playerByName.id;
        }
      }
    }
  }

  if (!voterPlayerId || !voterName) {
    return Response.json({ error: "You must be a participant in this game to vote." }, { status: 403 });
  }

  // Parse body
  const body = await request.json();
  const { votedForPlayerId } = body;
  if (!votedForPlayerId) {
    return Response.json({ error: "votedForPlayerId is required." }, { status: 400 });
  }

  // Validate target player exists in this event
  const targetPlayer = await prisma.player.findFirst({
    where: { id: votedForPlayerId, eventId: params.id },
  });
  if (!targetPlayer) {
    return Response.json({ error: "Target player not found in this event." }, { status: 400 });
  }

  // Prevent self-vote: check by userId or by playerId
  if (targetPlayer.userId === userId || targetPlayer.id === voterPlayerId) {
    return Response.json({ error: "You cannot vote for yourself." }, { status: 400 });
  }

  // Create vote (unique constraint prevents duplicates)
  try {
    const vote = await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId,
        voterName,
        votedForPlayerId: targetPlayer.id,
        votedForName: targetPlayer.name,
      },
    });
    return Response.json({ ok: true, vote: { id: vote.id, votedForName: vote.votedForName } });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return Response.json({ error: "You have already voted for this game." }, { status: 409 });
    }
    throw err;
  }
};
