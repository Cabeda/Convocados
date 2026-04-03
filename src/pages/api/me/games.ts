import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { parsePaginationParams } from "../../../lib/pagination";

export const GET: APIRoute = async ({ request }) => {
  // Support both OAuth bearer tokens and session cookies
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const { limit } = parsePaginationParams(url);
  const ownedCursor = url.searchParams.get("ownedCursor") || null;
  const joinedCursor = url.searchParams.get("joinedCursor") || null;

  const gameSelect = {
    id: true,
    title: true,
    location: true,
    dateTime: true,
    sport: true,
    maxPlayers: true,
    archivedAt: true,
    _count: { select: { players: true } },
  } as const;

  const [ownedEvents, joinedPlayers] = await Promise.all([
    prisma.event.findMany({
      where: { ownerId: userId },
      select: gameSelect,
      orderBy: { dateTime: "desc" },
      take: limit + 1,
      ...(ownedCursor ? { cursor: { id: ownedCursor }, skip: 1 } : {}),
    }),
    prisma.player.findMany({
      where: { userId },
      select: {
        id: true,
        event: {
          select: { ...gameSelect, ownerId: true },
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

  const mapGame = (e: typeof ownedSlice[number]) => ({
    ...e,
    dateTime: e.dateTime.toISOString(),
    archivedAt: e.archivedAt?.toISOString() ?? null,
    playerCount: e._count.players,
  });

  const allOwned = ownedSlice.map(mapGame);
  const allJoined = joinedSlice.map((p) => ({
    ...p.event,
    dateTime: p.event.dateTime.toISOString(),
    archivedAt: p.event.archivedAt?.toISOString() ?? null,
    playerCount: p.event._count.players,
  }));

  return Response.json({
    owned: allOwned.filter((g) => !g.archivedAt),
    joined: allJoined.filter((g) => !g.archivedAt),
    archivedOwned: allOwned.filter((g) => !!g.archivedAt),
    archivedJoined: allJoined.filter((g) => !!g.archivedAt),
    ownedNextCursor: ownedHasMore ? ownedSlice[ownedSlice.length - 1].id : null,
    ownedHasMore,
    joinedNextCursor: joinedHasMore && joinedSlice.length > 0
      ? joinedPlayers[Math.min(joinedPlayers.length, limit) - 1].id
      : null,
    joinedHasMore,
  });
};
