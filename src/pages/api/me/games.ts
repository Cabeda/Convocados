import type { APIRoute } from "astro";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { parsePaginationParams } from "../../../lib/pagination";
import { createLogger } from "../../../lib/logger.server";

const log = createLogger("me-games");

export const GET: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const { limit } = parsePaginationParams(url);
  const ownedCursor = url.searchParams.get("ownedCursor") || null;
  const followedCursor = url.searchParams.get("followedCursor") || null;

  const gameSelect = {
    id: true,
    title: true,
    location: true,
    dateTime: true,
    timezone: true,
    sport: true,
    maxPlayers: true,
    archivedAt: true,
    isRecurring: true,
    _count: { select: { players: true } },
    history: {
      select: { scoreOne: true, scoreTwo: true },
      orderBy: { dateTime: "desc" as const },
      take: 1,
    },
  } as const;

  type GameRow = Prisma.EventGetPayload<{ select: typeof gameSelect }>;
  const mapGame = (e: GameRow) => ({
    ...e,
    dateTime: e.dateTime.toISOString(),
    archivedAt: e.archivedAt?.toISOString() ?? null,
    playerCount: e._count.players,
    lastScoreOne: e.history[0]?.scoreOne ?? null,
    lastScoreTwo: e.history[0]?.scoreTwo ?? null,
  });

  const followedSelect = {
    id: true,
    event: { select: { ...gameSelect, ownerId: true } },
  } as const;

  const [ownedEvents, adminEvents, followedRecords] = await Promise.all([
    prisma.event.findMany({
      where: { ownerId: userId },
      select: gameSelect,
      orderBy: { dateTime: "desc" },
      take: limit + 1,
      ...(ownedCursor ? { cursor: { id: ownedCursor }, skip: 1 } : {}),
    }),
    prisma.event.findMany({
      where: { admins: { some: { userId } } },
      select: gameSelect,
      orderBy: { dateTime: "desc" },
      take: limit,
    }),
    prisma.eventFollow.findMany({
      where: { userId },
      select: followedSelect,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(followedCursor ? { cursor: { id: followedCursor }, skip: 1 } : {}),
    }).catch((err) => {
      // Schema drift: the EventFollow table may be missing if migrations
      // haven't been applied yet. Don't let it take down owned/admin data.
      log.warn({ err }, "eventFollow.findMany failed; returning empty list");
      return [] as Prisma.EventFollowGetPayload<{ select: typeof followedSelect }>[];
    }),
  ]);

  const ownedHasMore = ownedEvents.length > limit;
  const ownedSlice = ownedHasMore ? ownedEvents.slice(0, limit) : ownedEvents;
  const ownedIds = new Set(ownedSlice.map((e) => e.id));

  const adminSlice = adminEvents
    .filter((e) => !ownedIds.has(e.id))
    .slice(0, limit);

  const adminIds = new Set(adminSlice.map((e) => e.id));
  const reservedIds = new Set([...ownedIds, ...adminIds]);

  const followedDeduped = followedRecords.filter((r) => {
    if (reservedIds.has(r.event.id)) return false;
    reservedIds.add(r.event.id);
    return true;
  });
  const followedHasMore = followedRecords.length > limit;
  const followedSlice = followedDeduped.slice(0, limit);

  const allOwned = ownedSlice.map(mapGame);
  const allAdmin = adminSlice.map(mapGame);
  const allFollowed = followedSlice.map((r) => ({
    ...r.event,
    dateTime: r.event.dateTime.toISOString(),
    archivedAt: r.event.archivedAt?.toISOString() ?? null,
    playerCount: r.event._count.players,
    lastScoreOne: r.event.history[0]?.scoreOne ?? null,
    lastScoreTwo: r.event.history[0]?.scoreTwo ?? null,
  }));

  return Response.json({
    owned: allOwned.filter((g) => !g.archivedAt),
    admin: allAdmin.filter((g) => !g.archivedAt),
    followed: allFollowed.filter((g) => !g.archivedAt),
    archivedOwned: allOwned.filter((g) => !!g.archivedAt),
    archivedAdmin: allAdmin.filter((g) => !!g.archivedAt),
    ownedNextCursor: ownedHasMore ? ownedSlice[ownedSlice.length - 1].id : null,
    ownedHasMore,
    followedNextCursor: followedHasMore && followedSlice.length > 0
      ? followedRecords[Math.min(followedRecords.length, limit) - 1].id
      : null,
    followedHasMore,
  });
};
