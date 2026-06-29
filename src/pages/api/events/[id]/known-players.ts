import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";

export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, currentGameId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Current players in the active game (to exclude from suggestions)
  let currentNames = new Set<string>();
  if (event.currentGameId) {
    const participants = await prisma.gameParticipant.findMany({
      where: { gameId: event.currentGameId, archivedAt: null },
      include: { eventPlayer: { select: { name: true } } },
    });
    currentNames = new Set(participants.map((p) => p.eventPlayer.name.toLowerCase()));
  } else {
    // Fallback: legacy Player table
    const players = await prisma.player.findMany({
      where: { eventId, archivedAt: null },
      select: { name: true },
    });
    currentNames = new Set(players.map((p) => p.name.toLowerCase()));
  }

  // ADR 0016: read all EventPlayers for this event (replaces GameHistory JSON parsing)
  const eventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId },
    select: { name: true, userId: true, gamesPlayed: true },
  });

  const nameCounts = new Map<string, { gamesPlayed: number; userId: string | null }>();
  for (const ep of eventPlayers) {
    nameCounts.set(ep.name, { gamesPlayed: ep.gamesPlayed, userId: ep.userId });
  }

  // Also include followers not already in the map
  const followers = await prisma.eventFollow.findMany({
    where: { eventId },
    include: { user: { select: { id: true, name: true } } },
  });
  for (const f of followers) {
    const name = f.user.name.trim();
    if (name && !nameCounts.has(name)) {
      nameCounts.set(name, { gamesPlayed: 0, userId: f.user.id });
    }
  }

  // Include logged-in user's own name
  // ponytail: ensures self-join autocomplete works even if user has no history/follow
  const session = await getSession(request).catch(() => null);
  if (session?.user?.name) {
    const name = session.user.name.trim();
    if (name && !nameCounts.has(name)) {
      nameCounts.set(name, { gamesPlayed: 0, userId: session.user.id });
    }
  }

  const players = Array.from(nameCounts.entries())
    .filter(([name]) => !currentNames.has(name.toLowerCase()))
    .map(([name, data]) => ({
      name,
      gamesPlayed: data.gamesPlayed,
      userId: data.userId,
    }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, 30);

  return Response.json({ players });
};
