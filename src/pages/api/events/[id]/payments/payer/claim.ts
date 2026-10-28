import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { setPaymentConfig } from "~/lib/settlement.server";

/**
 * POST /api/events/[id]/payments/payer/claim
 *
 * Any active roster player may claim the Payer role for a Game (ADR 0055), at
 * any time — the role is not a privilege, it is a chore somebody has to take.
 * Body: { gameId? } — defaults to the Event's current Game.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id ?? null;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, currentGameId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  let body: { gameId?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is fine: the current Game is the default.
  }
  const gameId = typeof body.gameId === "string" ? body.gameId : event.currentGameId;
  if (!gameId) return Response.json({ error: "No active game to claim." }, { status: 400 });

  // You can only claim the role for yourself, and only if you are on the roster.
  const me = await prisma.eventPlayer.findFirst({
    where: { eventId, userId },
    select: { id: true, name: true },
  });
  if (!me) {
    return Response.json({ error: "Only a roster player can claim the payer role." }, { status: 403 });
  }

  try {
    await setPaymentConfig(eventId, gameId, { mode: "tracked", payerEventPlayerId: me.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid payment config.";
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ ok: true, gameId, payerEventPlayerId: me.id, payerName: me.name });
};
