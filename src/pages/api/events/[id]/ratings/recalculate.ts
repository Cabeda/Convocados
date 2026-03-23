import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { recalculateAllRatings } from "../../../../../lib/elo.server";
import { checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../../lib/eventLog.server";

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "heavy");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin, session } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const processed = await recalculateAllRatings(params.id!);

  const actorName = session?.user?.name ?? null;
  const actorId = session?.user?.id ?? null;
  logEvent(params.id!, "rating_recalculated", actorName, actorId, {
    gamesProcessed: processed,
  });

  return Response.json({ ok: true, gamesProcessed: processed });
};
