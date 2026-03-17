import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { parsePaginationParams } from "../../../lib/pagination";

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const url = new URL(request.url);
  const { limit } = parsePaginationParams(url);
  const ownedCursor = url.searchParams.get("ownedCursor") || null;
  const joinedCursor = url.searchParams.get("joinedCursor") || null;

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
      take: limit + 1,
      ...(ownedCursor ? { cursor: { id: ownedCursor }, skip: 1 } : {}),
    }),
    prisma.player.findMany({
      where: { userId },
      select: {
        id: true,
        event: {
          select: {
            id: true,
            title: true,
            location: true,
            dateTime: true,
            sport: true,
            maxPlayers: true,
            ownerId: true,
            _count: { select: { players: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(joinedCursor ? { cursor: { id: joinedCursor }, skip: 1 } : {}),
    }),
  ]);

  // Owned pagination
  const ownedHasMore = ownedEvents.length > limit;
  const ownedSlice = ownedHasMore ? ownedEvents.slice(0, limit) : ownedEvents;
  const ownedIds = new Set(ownedSlice.map((e) => e.id));

  // Joined: deduplicate and exclude owned
  const seen = new Set<string>();
  const joinedDeduped = joinedPlayers.filter((p) => {
    if (ownedIds.has(p.event.id) || seen.has(p.event.id)) return false;
    seen.add(p.event.id);
    return true;
  });
  const joinedHasMore = joinedPlayers.length > limit;
  const joinedSlice = joinedDeduped.slice(0, limit);

  return Response.json({
    owned: ownedSlice.map((e) => ({
      ...e,
      dateTime: e.dateTime.toISOString(),
      playerCount: e._count.players,
    })),
    joined: joinedSlice.map((p) => ({
      ...p.event,
      dateTime: p.event.dateTime.toISOString(),
      playerCount: p.event._count.players,
    })),
    ownedNextCursor: ownedHasMore ? ownedSlice[ownedSlice.length - 1].id : null,
    ownedHasMore,
    joinedNextCursor: joinedHasMore && joinedSlice.length > 0
      ? joinedPlayers[Math.min(joinedPlayers.length, limit) - 1].id
      : null,
    joinedHasMore,
  });
};
