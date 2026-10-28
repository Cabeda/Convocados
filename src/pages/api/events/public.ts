import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { parsePaginationParams } from "../../../lib/pagination";
import { discoverableUpcomingWhere, mapDiscoverableEvent } from "../../../lib/discoverableEvents.server";
import { filterCancelledCurrentGames } from "../../../lib/currentGame.server";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const { limit, cursor } = parsePaginationParams(url);

  const events = await prisma.event.findMany({
    where: discoverableUpcomingWhere(),
    include: {
      _count: { select: { players: { where: { archivedAt: null } } } },
    },
    orderBy: { dateTime: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  // Keep the window's last raw event as the cursor even when it is filtered:
  // starting the next page after a cancelled row skips nothing joinable.
  const page = events.slice(0, limit);
  const visible = await filterCancelledCurrentGames(page);
  const hasMore = events.length > limit;

  return Response.json({
    data: visible.map(mapDiscoverableEvent),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    hasMore,
  });
};
