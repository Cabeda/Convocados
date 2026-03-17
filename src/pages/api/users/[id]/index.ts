import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";

/** GET — user profile with game history, filtered by viewer permissions */
export const GET: APIRoute = async ({ params, request }) => {
  const userId = params.id!;
  const session = await getSession(request);
  const viewerId = session?.user?.id ?? null;
  const isOwnProfile = viewerId === userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, createdAt: true },
  });

  if (!user) return Response.json({ error: "User not found." }, { status: 404 });

  // Get all events the profile user owns or joined, including visibility + players
  const ownedEvents = await prisma.event.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      title: true,
      location: true,
      dateTime: true,
      sport: true,
      maxPlayers: true,
      isPublic: true,
      ownerId: true,
      _count: { select: { players: true } },
      players: { select: { userId: true } },
    },
    orderBy: { dateTime: "desc" },
    take: 50,
  });

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
          isPublic: true,
          ownerId: true,
          _count: { select: { players: true } },
          players: { select: { userId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Deduplicate joined events (exclude owned)
  const ownedIds = new Set(ownedEvents.map((e) => e.id));
  const seen = new Set<string>();
  const joinedEvents = playerEntries
    .map((p) => p.event)
    .filter((e) => {
      if (ownedIds.has(e.id) || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

  // Filter based on viewer permissions:
  // - Anonymous: only public events
  // - Authenticated: public events + private events where viewer is also a player or owner
  const canView = (event: { isPublic: boolean; ownerId: string | null; players: { userId: string | null }[] }) => {
    if (event.isPublic) return true;
    if (!viewerId) return false;
    // Viewer is the profile user themselves
    if (viewerId === userId) return true;
    // Viewer is the event owner
    if (event.ownerId === viewerId) return true;
    // Viewer is also a player in this event
    return event.players.some((p) => p.userId === viewerId);
  };

  const visibleOwned = ownedEvents.filter(canView);
  const visibleJoined = joinedEvents.filter(canView);

  const serialize = (e: typeof ownedEvents[number]) => ({
    id: e.id,
    title: e.title,
    location: e.location,
    dateTime: e.dateTime.toISOString(),
    sport: e.sport,
    maxPlayers: e.maxPlayers,
    playerCount: e._count.players,
  });

  return Response.json({
    user: {
      id: user.id,
      name: user.name,
      email: isOwnProfile ? user.email : undefined,
      image: user.image,
      createdAt: user.createdAt.toISOString(),
    },
    owned: visibleOwned.map(serialize),
    joined: visibleJoined.map(serialize),
    stats: {
      totalGames: visibleOwned.length + visibleJoined.length,
      ownedGames: visibleOwned.length,
      joinedGames: visibleJoined.length,
    },
    isOwnProfile,
  });
};

/** PATCH — update own profile (name only; email changes should go through better-auth) */
export const PATCH: APIRoute = async ({ params, request }) => {
  const userId = params.id!;
  const session = await getSession(request);

  if (!session?.user || session.user.id !== userId) {
    return Response.json({ error: "Unauthorized." }, { status: 403 });
  }

  const body = await request.json();

  if (typeof body.name !== "string" || !body.name.trim()) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  const name = body.name.trim().slice(0, 50);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { name },
    select: { id: true, name: true, email: true, image: true },
  });

  return Response.json({ user: updated });
};
