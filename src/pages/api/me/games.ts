import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [ownedEvents, joinedPlayers] = await Promise.all([
    prisma.event.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        title: true,
        location: true,
        dateTime: true,
        sport: true,
        maxPlayers: true,
        _count: { select: { players: true } },
      },
      orderBy: { dateTime: "desc" },
    }),
    prisma.player.findMany({
      where: { userId },
      select: {
        event: {
          select: {
            id: true,
            title: true,
            location: true,
            dateTime: true,
            sport: true,
            maxPlayers: true,
            _count: { select: { players: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Deduplicate joined events (exclude owned ones)
  const ownedIds = new Set(ownedEvents.map((e) => e.id));
  const joinedEvents = joinedPlayers
    .map((p) => p.event)
    .filter((e) => !ownedIds.has(e.id));

  // Deduplicate joined events by id
  const seen = new Set<string>();
  const uniqueJoined = joinedEvents.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return Response.json({
    owned: ownedEvents.map((e) => ({
      ...e,
      dateTime: e.dateTime.toISOString(),
      playerCount: e._count.players,
    })),
    joined: uniqueJoined.map((e) => ({
      ...e,
      dateTime: e.dateTime.toISOString(),
      playerCount: e._count.players,
    })),
  });
};
