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
  const gameEndTime = new Date(history.dateTime.getTime() + (event.durationMinutes ?? 60) * 60_000);
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

  // Only players who actually played in this game (appear in teamsSnapshot) can vote.
  let voterName: string | undefined;
  let voterPlayerId: string | undefined;

  if (history.teamsSnapshot && session.user?.name) {
    const teams = JSON.parse(history.teamsSnapshot) as Array<{ team: string; players: Array<{ name: string }> }>;
    const allPlayers = teams.flatMap((t) => t.players);
    const match = allPlayers.find((p) => p.name.toLowerCase() === session.user!.name!.toLowerCase());
    if (match) {
      voterName = match.name;
      // Try to find the Player record for this user (may exist if they signed up)
      const voterPlayer = await prisma.player.findFirst({
        where: { eventId: params.id, userId },
      });
      voterPlayerId = voterPlayer?.id ?? `name:${match.name}`;
    }
  }

  if (!voterPlayerId || !voterName) {
    return Response.json({ error: "You must be a participant in this game to vote." }, { status: 403 });
  }

  // Parse body
  const body = await request.json();
  const { votedForPlayerId, votedForName: votedForNameBody } = body;
  if (!votedForPlayerId && !votedForNameBody) {
    return Response.json({ error: "votedForPlayerId or votedForName is required." }, { status: 400 });
  }

  // Resolve target player — by ID first, then by name in teamsSnapshot
  let targetPlayerId: string;
  let targetPlayerName: string;

  if (votedForPlayerId && !votedForPlayerId.startsWith("name:")) {
    const targetPlayer = await prisma.player.findFirst({
      where: { id: votedForPlayerId, eventId: params.id },
    });
    if (!targetPlayer) {
      return Response.json({ error: "Target player not found in this event." }, { status: 400 });
    }
    targetPlayerId = targetPlayer.id;
    targetPlayerName = targetPlayer.name;

    // Prevent self-vote: check by userId or by playerId
    if (targetPlayer.userId === userId || targetPlayer.id === voterPlayerId) {
      return Response.json({ error: "You cannot vote for yourself." }, { status: 400 });
    }
  } else {
    // Name-based voting (Player records may have been deleted after recurrence reset)
    const nameToVoteFor = votedForNameBody || (votedForPlayerId?.startsWith("name:") ? votedForPlayerId.slice(5) : null);
    if (!nameToVoteFor || !history.teamsSnapshot) {
      return Response.json({ error: "Target player not found." }, { status: 400 });
    }
    const teams = JSON.parse(history.teamsSnapshot) as Array<{ team: string; players: Array<{ name: string }> }>;
    const allNames = teams.flatMap((t) => t.players.map((p) => p.name));
    const match = allNames.find((n) => n.toLowerCase() === nameToVoteFor.toLowerCase());
    if (!match) {
      return Response.json({ error: "Target player not found in this game." }, { status: 400 });
    }
    targetPlayerId = `name:${match}`;
    targetPlayerName = match;

    // Prevent self-vote by name
    if (voterName && match.toLowerCase() === voterName.toLowerCase()) {
      return Response.json({ error: "You cannot vote for yourself." }, { status: 400 });
    }
  }

  // Upsert vote (swap if already voted)
  const vote = await prisma.mvpVote.upsert({
    where: { gameHistoryId_voterPlayerId: { gameHistoryId: history.id, voterPlayerId } },
    create: { gameHistoryId: history.id, voterPlayerId, voterName: voterName as string, votedForPlayerId: targetPlayerId, votedForName: targetPlayerName },
    update: { votedForPlayerId: targetPlayerId, votedForName: targetPlayerName },
  });
  return Response.json({ ok: true, vote: { id: vote.id, votedForName: vote.votedForName } });
};
