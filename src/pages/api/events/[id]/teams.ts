import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import type { Imatch } from "../../../../lib/random";

export const PUT: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const { matches }: { matches: Imatch[] } = await request.json();

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
