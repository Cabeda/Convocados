import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { settleAllHistoricalForPlayer } from "~/lib/payments.server";

/**
 * POST /api/events/[id]/payments/historical/bulk
 *
 * Body: { playerName: string }
 *
 * Settles EVERY pending/sent historical game for the player in one go.
 * Owner/Admin only.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }
  const session = await getSession(request);
  const markedById = session?.user?.id ?? event.ownerId ?? "";

  const body = await request.json();
  const playerName = String(body.playerName ?? "").trim();
  if (!playerName) {
    return Response.json({ error: "playerName is required." }, { status: 400 });
  }

  const result = await settleAllHistoricalForPlayer({ eventId, playerName, markedById });
  return Response.json({ ok: true, ...result });
};
