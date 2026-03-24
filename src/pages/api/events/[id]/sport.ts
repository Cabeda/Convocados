import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getDefaultMaxPlayers } from "../../../../lib/sports";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const sport = String(body.sport ?? "").trim().slice(0, 50);
  if (!sport) return Response.json({ error: "Sport is required." }, { status: 400 });

  const defaultMaxPlayers = getDefaultMaxPlayers(sport);

  await prisma.event.update({
    where: { id: params.id },
    data: { sport, maxPlayers: defaultMaxPlayers },
  });


  return Response.json({ sport, maxPlayers: defaultMaxPlayers });
};
