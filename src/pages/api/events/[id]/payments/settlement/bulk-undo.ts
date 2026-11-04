import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession } from "../../../../../../lib/auth.helpers.server";
import { authorizeEventMutation } from "../../../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";
import { bulkUnsettleGame, isGameParticipant } from "../../../../../../lib/settlement.server";

/**
 * POST /api/events/[id]/payments/settlement/bulk-undo
 * Revert a set of debtor shares settled by mark-all-paid (Undo). Atomic.
 * Body: { gameId, eventPlayerIds: string[] }
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const body = await request.json();
  const gameId = String(body.gameId ?? "");
  const eventPlayerIds = Array.isArray(body.eventPlayerIds) ? body.eventPlayerIds.map(String) : [];
  if (!gameId || eventPlayerIds.length === 0) {
    return Response.json({ error: "gameId and eventPlayerIds are required." }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { eventId: true } });
  if (!game || game.eventId !== eventId) {
    return Response.json({ error: "gameId does not belong to this event." }, { status: 400 });
  }

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed && !(session?.user && (await isGameParticipant(eventId, gameId, session.user.id)))) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  try {
    const reverted = await bulkUnsettleGame(eventId, gameId, eventPlayerIds);
    return Response.json({ ok: true, reverted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to undo.";
    return Response.json({ error: message }, { status: 400 });
  }
};