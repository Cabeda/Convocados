import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getDefaultMaxPlayers } from "../../../../lib/sports";

export const PUT: APIRoute = async ({ params, request }) => {
  const body = await request.json();
  const sport = String(body.sport ?? "").trim().slice(0, 50);
  if (!sport) return Response.json({ error: "Sport is required." }, { status: 400 });

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const defaultMaxPlayers = getDefaultMaxPlayers(sport);

  await prisma.event.update({
    where: { id: params.id },
    data: { sport, maxPlayers: defaultMaxPlayers },
  });

  return Response.json({ sport, maxPlayers: defaultMaxPlayers });
};
