import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";
import { selfReportSent } from "../../../../../../lib/settlement.server";

/**
 * POST /api/events/[id]/payments/settlement/self-report
 * The debtor marks their own share as sent (pending → sent). Own share only.
 * Body: { gameId, eventPlayerId }
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
  const eventPlayerId = String(body.eventPlayerId ?? "");
  if (!gameId || !eventPlayerId) return Response.json({ error: "gameId and eventPlayerId are required." }, { status: 400 });

  const own = await prisma.eventPlayer.findFirst({
    where: { id: eventPlayerId, eventId, userId: session.user.id },
    select: { id: true },
  });
  if (!own) {
    return Response.json({ error: "You can only report your own payment." }, { status: 403 });
  }

  try {
    await selfReportSent(gameId, eventPlayerId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to report payment.";
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ ok: true });
};
