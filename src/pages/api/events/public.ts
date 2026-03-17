import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { parsePaginationParams, buildPaginatedResponse } from "../../../lib/pagination";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const { limit, cursor } = parsePaginationParams(url);

  const events = await prisma.event.findMany({
    where: { isPublic: true },
    include: {
      players: { orderBy: { order: "asc" } },
    },
    orderBy: { dateTime: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const mapped = events.map((e) => ({
    id: e.id,
    title: e.title,
    location: e.location,
    latitude: e.latitude,
    longitude: e.longitude,
    sport: e.sport,
    dateTime: e.dateTime.toISOString(),
    maxPlayers: e.maxPlayers,
    playerCount: e.players.length,
    spotsLeft: Math.max(0, e.maxPlayers - e.players.length),
  }));

  return Response.json(buildPaginatedResponse(mapped, limit));
};
