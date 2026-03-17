import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { parsePaginationParams, buildPaginatedResponse } from "../../../../../lib/pagination";

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const url = new URL(request.url);
  const { limit, cursor } = parsePaginationParams(url);

  const ratings = await prisma.playerRating.findMany({
    where: { eventId: params.id },
    orderBy: { rating: "desc" },
    select: { id: true, name: true, rating: true, gamesPlayed: true, wins: true, draws: true, losses: true },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return Response.json(buildPaginatedResponse(ratings, limit));
};
