import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { setPaymentConfig } from "../../../../../lib/settlement.server";

/**
 * PATCH /api/events/[id]/payments/config
 * Owner/admin sets a game's payment mode + payer.
 * Body: { gameId?, mode: "tracked"|"untracked", payerEventPlayerId?, payerExternalName? }
 * gameId defaults to the event's current game.
 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const mode = body.mode === "untracked" ? "untracked" : "tracked";
  const gameId = typeof body.gameId === "string" ? body.gameId : event.currentGameId;
  if (!gameId) {
    return Response.json({ error: "No active game to configure." }, { status: 400 });
  }

  try {
    await setPaymentConfig(eventId, gameId, {
      mode,
      payerEventPlayerId: typeof body.payerEventPlayerId === "string" ? body.payerEventPlayerId : undefined,
      payerExternalName: typeof body.payerExternalName === "string" ? body.payerExternalName : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid payment config.";
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ ok: true, gameId, mode });
};
