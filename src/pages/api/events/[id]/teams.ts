import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import type { Imatch } from "../../../../lib/random";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { sseManager } from "../../../../lib/sse.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const { matches }: { matches: Imatch[] } = await request.json();

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { maxPlayers: true },
  });

  if (!event) {
    return Response.json({ error: "Event not found" }, { status: 404 });
  }

  const allPlayersInMatches = new Set(
    matches.flatMap((m) => m.players.map((p) => p.name))
  );

  const validPlayers = await prisma.player.findMany({
    where: { eventId },
    orderBy: { order: "asc" },
    take: event.maxPlayers,
    select: { name: true },
  });

  const validPlayerNames = new Set(validPlayers.map((p) => p.name));
  const invalidPlayers = [...allPlayersInMatches].filter(
    (name) => !validPlayerNames.has(name)
  );

  if (invalidPlayers.length > 0) {
    return Response.json(
      {
        error: `Invalid players in teams: ${invalidPlayers.join(", ")}. Only active players (first ${event.maxPlayers}) can be assigned to teams.`,
      },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.teamResult.deleteMany({ where: { eventId } }),
    ...matches.map((match) =>
      prisma.teamResult.create({
        data: {
          name: match.team,
          eventId,
          members: { create: match.players.map((p) => ({ name: p.name, order: p.order })) },
        },
      })
    ),
  ]);

  sseManager.broadcast(eventId, "update", { action: "teams_updated" });

  return Response.json({ ok: true });
};
