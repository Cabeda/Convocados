import type { Prisma } from "@prisma/client";
import { prisma } from "./db.server";
import { createLogger } from "./logger.server";

const log = createLogger("my-games");

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
  currentGameId: true,
  _count: { select: { players: true } },
  history: {
    select: { scoreOne: true, scoreTwo: true },
    orderBy: { dateTime: "desc" as const },
    take: 1,
  },
} as const;

type GameRow = Prisma.EventGetPayload<{ select: typeof gameSelect }>;

async function resolvePlayerCount(e: GameRow): Promise<number> {
  if (e.currentGameId) {
    return prisma.gameParticipant.count({
      where: { gameId: e.currentGameId, archivedAt: null },
    });
  }
  return e._count.players;
}

const mapGame = async (e: GameRow) => ({
  ...e,
  dateTime: e.dateTime.toISOString(),
  archivedAt: e.archivedAt?.toISOString() ?? null,
  playerCount: await resolvePlayerCount(e),
  lastScoreOne: e.history[0]?.scoreOne ?? null,
  lastScoreTwo: e.history[0]?.scoreTwo ?? null,
});

/**
 * Fetch owned/admin/followed games for a user with cursor pagination.
 * Shared between /api/me/games and MCP convocados_list_my_games.
 */
export async function fetchMyGames(userId: string, limit = 20, ownedCursor: string | null = null, followedCursor: string | null = null) {
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
      log.warn({ err }, "eventFollow.findMany failed; returning empty list");
      return [] as Prisma.EventFollowGetPayload<{ select: typeof followedSelect }>[];
    }),
  ]);

  const ownedHasMore = ownedEvents.length > limit;
  const ownedSlice = ownedHasMore ? ownedEvents.slice(0, limit) : ownedEvents;
  const ownedIds = new Set(ownedSlice.map((e) => e.id));

  const adminSlice = adminEvents.filter((e) => !ownedIds.has(e.id)).slice(0, limit);
  const adminIds = new Set(adminSlice.map((e) => e.id));
  const reservedIds = new Set([...ownedIds, ...adminIds]);

  const followedDeduped = followedRecords.filter((r) => {
    if (reservedIds.has(r.event.id)) return false;
    reservedIds.add(r.event.id);
    return true;
  });
  const followedHasMore = followedRecords.length > limit;
  const followedSlice = followedDeduped.slice(0, limit);

  const [allOwned, allAdmin, allFollowed] = await Promise.all([
    Promise.all(ownedSlice.map(mapGame)),
    Promise.all(adminSlice.map(mapGame)),
    Promise.all(followedSlice.map((r) => mapGame(r.event as unknown as GameRow))),
  ]);

  return {
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
  };
}
