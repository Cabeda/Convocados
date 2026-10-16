import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession } from "../../../../../lib/auth.helpers.server";
import { authorizeEventMutation } from "../../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { getSettlementSummary, settleShare, unsettleShare, isEventParticipant, isGameParticipant } from "../../../../../lib/settlement.server";

/**
 * GET  /api/events/[id]/payments/settlement — people-first settlement summary.
 *      Receivers (payers) public to event players; debtor names owner/admin-only;
 *      a player sees only their own debt. Owner/admin, event player, or the holder
 *      of an ownerless unlisted Event's link required — the link holder reads the
 *      payers-only view, never the manager view.
 * PUT  /api/events/[id]/payments/settlement — settle one share (owner/admin).
 *      Body: { gameId, eventPlayerId }
 * DELETE /api/events/[id]/payments/settlement — revert a settled share (owner/admin).
 *      Body: { gameId, eventPlayerId }
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);

  // Owner/admin come from the shared Event authorization module; anyone else is a
  // player. `ownerless-open` (ownerless + unlisted — the share link is the
  // capability, ADR 0035) maps onto that player role, NOT onto owner/admin: the
  // link holder gets the basic view (payers only, their own debt if signed in) and
  // never the manager view. An ownerless PUBLIC event is still forbidden — there
  // the Event is discoverable, so the openness is not a secret.
  const authz = await authorizeEventMutation(request, event, session);
  const role = authz.role === "owner" || authz.role === "admin" ? authz.role : "player";
  const userId = session?.user?.id ?? null;

  // A link holder reads the basic view. Everyone else must be a signed-in
  // participant. A password-protected Event is not open by link — the seam
  // (`authorizeEventMutation`) already refuses `ownerless-open` there, so this
  // route does not repeat the check.
  const linkHolderRead = authz.role === "ownerless-open";

  // Managers always read.
  if (role !== "owner" && role !== "admin" && !linkHolderRead) {
    if (!userId) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    if (role === "player" && !(await isEventParticipant(eventId, userId))) {
      return Response.json({ error: "Only event players can view payments." }, { status: 403 });
    }
  }

  try {
    const summary = await getSettlementSummary(eventId, { role, userId });
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

  const session = await getSession(request);
  const body = await request.json();
  const gameId = String(body.gameId ?? "");
  const eventPlayerId = String(body.eventPlayerId ?? "");
  if (!gameId || !eventPlayerId) {
    return Response.json({ error: "gameId and eventPlayerId are required." }, { status: 400 });
  }

  // Bind the supplied game to THIS event — otherwise an owner/admin of event A
  // could settle shares on a game belonging to event B.
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { eventId: true } });
  if (!game || game.eventId !== eventId) {
    return Response.json({ error: "gameId does not belong to this event." }, { status: 400 });
  }

  const authz = await authorizeEventMutation(request, event, session);
  // Owner/admin (and the ownerless-open link) manage any game; a participant may
  // settle within their own game.
  if (!authz.allowed) {
    if (!session?.user || !(await isGameParticipant(eventId, gameId, session.user.id))) {
      return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
    }
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

export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const body = await request.json();
  const gameId = String(body.gameId ?? "");
  const eventPlayerId = String(body.eventPlayerId ?? "");
  if (!gameId || !eventPlayerId) {
    return Response.json({ error: "gameId and eventPlayerId are required." }, { status: 400 });
  }

  // Bind the supplied game to THIS event (see PUT above).
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { eventId: true } });
  if (!game || game.eventId !== eventId) {
    return Response.json({ error: "gameId does not belong to this event." }, { status: 400 });
  }

  const session = await getSession(request);
  const authz = await authorizeEventMutation(request, event, session);
  // Owner/admin (and the ownerless-open link) manage any game; a participant may
  // revert within their own game.
  if (!authz.allowed) {
    if (!session?.user || !(await isGameParticipant(eventId, gameId, session.user.id))) {
      return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
    }
  }

  try {
    await unsettleShare(eventId, gameId, eventPlayerId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to revert share.";
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ ok: true, gameId, eventPlayerId });
};
