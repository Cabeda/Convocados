import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { recalculateAllRatings } from "../../../../../lib/elo.server";
import { checkOwnership } from "../../../../../lib/auth.helpers.server";

export const POST: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const processed = await recalculateAllRatings(params.id!);
  return Response.json({ ok: true, gamesProcessed: processed });
};
