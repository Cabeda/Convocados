import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { parsePaginationParams, buildPaginatedResponse } from "../../../lib/pagination";
import { discoverableUpcomingWhere, mapDiscoverableEvent } from "../../../lib/discoverableEvents.server";

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

  return Response.json(buildPaginatedResponse(events.map(mapDiscoverableEvent), limit));
};
