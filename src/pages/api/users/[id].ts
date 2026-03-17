import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";

/** GET — public user profile with game history */
export const GET: APIRoute = async ({ params }) => {
  const userId = params.id!;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, image: true, createdAt: true },
  });

  if (!user) return Response.json({ error: "User not found." }, { status: 404 });

  // Games the user owns
  const ownedEvents = await prisma.event.findMany({
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
    take: 50,
  });

  // Games the user joined as a player
  const playerEntries = await prisma.player.findMany({
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
    take: 100,
  });

  // Deduplicate joined events
  const ownedIds = new Set(ownedEvents.map((e) => e.id));
  const seen = new Set<string>();
  const joinedEvents = playerEntries
    .map((p) => p.event)
    .filter((e) => {
      if (ownedIds.has(e.id) || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

  return Response.json({
    user: {
      id: user.id,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt.toISOString(),
    },
    owned: ownedEvents.map((e) => ({
      id: e.id,
      title: e.title,
      location: e.location,
      dateTime: e.dateTime.toISOString(),
      sport: e.sport,
      maxPlayers: e.maxPlayers,
      playerCount: e._count.players,
    })),
    joined: joinedEvents.map((e) => ({
      id: e.id,
      title: e.title,
      location: e.location,
      dateTime: e.dateTime.toISOString(),
      sport: e.sport,
      maxPlayers: e.maxPlayers,
      playerCount: e._count.players,
    })),
    stats: {
      totalGames: ownedEvents.length + joinedEvents.length,
      ownedGames: ownedEvents.length,
      joinedGames: joinedEvents.length,
    },
  });
};
