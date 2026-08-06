import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { checkOwnership, getSession } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";
import { bulkSettleGame } from "../../../../../../lib/settlement.server";

/**
 * PUT /api/events/[id]/payments/settlement/bulk
 * Owner/admin marks all debtor shares of a game paid (dual-writes the ledger).
 * Body: { gameId }
 */
export const PUT: APIRoute = async ({ params, request }) => {
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
  const body = await request.json();
  const gameId = String(body.gameId ?? "");
  if (!gameId) return Response.json({ error: "gameId is required." }, { status: 400 });

  const markedBy = session?.user?.id ?? event.ownerId ?? "unknown";
  try {
    const updated = await bulkSettleGame(eventId, gameId, markedBy);
    return Response.json({ ok: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to settle game.";
    return Response.json({ error: message }, { status: 400 });
  }
};
