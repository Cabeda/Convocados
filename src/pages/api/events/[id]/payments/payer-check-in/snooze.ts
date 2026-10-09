import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";
import { SNOOZE_HOURS } from "../../../../../../lib/payerCheckIn.server";

/**
 * POST /api/events/[id]/payments/payer-check-in/snooze
 * #1236: the payer answers the 24h check-in with "ask me again later" —
 * suppresses the next ask for SNOOZE_HOURS.
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
    select: { eventId: true, payerEventPlayer: { select: { userId: true } } },
  });
  if (!game || game.eventId !== eventId) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  if (game.payerEventPlayer?.userId !== session.user.id) {
    return Response.json({ error: "Only the payer can do this." }, { status: 403 });
  }

  const snoozedUntil = new Date(Date.now() + SNOOZE_HOURS * 60 * 60 * 1000);
  await prisma.game.update({
    where: { id: gameId },
    data: { payerCheckInSnoozedUntil: snoozedUntil },
  });

  return Response.json({ ok: true, snoozedUntil });
};
