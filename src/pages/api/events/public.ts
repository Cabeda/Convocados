import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";

export const GET: APIRoute = async () => {
  const events = await prisma.event.findMany({
    where: { isPublic: true },
    include: {
      players: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { dateTime: "asc" },
  });

  return Response.json(
    events.map((e) => ({
      id: e.id,
      title: e.title,
      location: e.location,
      sport: e.sport,
      dateTime: e.dateTime.toISOString(),
      maxPlayers: e.maxPlayers,
      playerCount: e.players.length,
      spotsLeft: Math.max(0, e.maxPlayers - e.players.length),
    }))
  );
};
