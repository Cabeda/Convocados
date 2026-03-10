import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { Randomize } from "../../../../lib/random";

export const POST: APIRoute = async ({ params }) => {
  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const players = await prisma.player.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    take: event.maxPlayers,
  });
  if (players.length < 2) return Response.json({ error: "Need at least 2 players." }, { status: 400 });

  const matches = Randomize(players.map((p) => p.name), [event.teamOneName, event.teamTwoName]);

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

  return Response.json({ ok: true });
};
