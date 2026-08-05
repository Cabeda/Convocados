import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession } from "../../../../../lib/auth.helpers.server";
import { getCurrentGameSettlement } from "../../../../../lib/settlement.server";

/**
 * GET /api/events/[id]/payments/game — the event's current game payment state
 * (mode, payer, all rows). Login required; any participant may view.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const settlement = await getCurrentGameSettlement(eventId);
    return Response.json(settlement ?? { gameId: null, mode: "tracked", payerName: null, payerIsPlayer: false, hasCost: false, rows: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load game payments.";
    return Response.json({ error: message }, { status: 400 });
  }
};
