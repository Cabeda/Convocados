import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";

export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const ratings = await prisma.playerRating.findMany({
    where: { eventId: params.id },
    orderBy: { rating: "desc" },
    select: { name: true, rating: true, gamesPlayed: true, wins: true, draws: true, losses: true },
  });

  return Response.json(ratings);
};
