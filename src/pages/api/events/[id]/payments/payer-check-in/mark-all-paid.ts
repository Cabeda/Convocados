import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";
import { bulkSettleGame } from "../../../../../../lib/settlement.server";

/**
 * POST /api/events/[id]/payments/payer-check-in/mark-all-paid
 * #1236: the payer answers the 24h check-in with "everyone paid" — settle
 * every unpaid share of the game (dual-writes the ledger).
 * Body: { gameId }
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json();
  const gameId = String(body.gameId ?? "");
  if (!gameId) return Response.json({ error: "gameId is required." }, { status: 400 });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { eventId: true, dateTime: true, payerEventPlayer: { select: { userId: true } } },
  });
  if (!game || game.eventId !== eventId) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  if (game.payerEventPlayer?.userId !== session.user.id) {
    return Response.json({ error: "Only the payer can do this." }, { status: 403 });
  }

  // Only a game that has actually happened can be settled this way.
  const gameEnd = new Date(game.dateTime.getTime() + event.durationMinutes * 60_000);
  if (gameEnd.getTime() > Date.now()) {
    return Response.json({ error: "The game has not ended yet." }, { status: 409 });
  }

  try {
    const updated = await bulkSettleGame(eventId, gameId, session.user.id);
    // The payer answered the check-in — stop asking about this game (#1236).
    await prisma.game.update({
      where: { id: gameId },
      data: { payerCheckInSentAt: new Date(), payerCheckInSnoozedUntil: null },
    });
    return Response.json({ ok: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to settle game.";
    return Response.json({ error: message }, { status: 400 });
  }
};
