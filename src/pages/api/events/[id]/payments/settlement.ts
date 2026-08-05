import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { checkOwnership, getSession } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { getSettlementSummary, settleShare } from "../../../../../lib/settlement.server";

/**
 * GET  /api/events/[id]/payments/settlement — people-first settlement summary.
 *      Receivers (payers) public to logged-in players; debtor names owner/admin-only;
 *      a player sees only their own debt. Anonymous denied.
 * PUT  /api/events/[id]/payments/settlement — settle one share (owner/admin).
 *      Body: { gameId, eventPlayerId }
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  const role = isOwner ? "owner" : isAdmin ? "admin" : "player";

  try {
    const summary = await getSettlementSummary(eventId, { role, userId: session.user.id });
    return Response.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load settlement summary.";
    return Response.json({ error: message }, { status: 400 });
  }
};

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
  const eventPlayerId = String(body.eventPlayerId ?? "");
  if (!gameId || !eventPlayerId) {
    return Response.json({ error: "gameId and eventPlayerId are required." }, { status: 400 });
  }

  const markedBy = session?.user?.id ?? event.ownerId ?? "unknown";
  try {
    await settleShare(eventId, gameId, eventPlayerId, markedBy);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to settle share.";
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ ok: true, gameId, eventPlayerId });
};
