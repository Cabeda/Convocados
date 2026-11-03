import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkOwnership, checkEventAdmin } from "../../../../lib/auth.helpers.server";
import { getOutstandingBalance, getGateBalance, getEventBalanceSummary } from "../../../../lib/balance.server";
import { checkAccess } from "../../../../lib/eventAccess";

/**
 * GET /api/events/[id]/balance
 * Returns the caller's own balance + aggregate summary.
 * Owner/Admin also get the full per-player breakdown.
 * Names are visible to regular players only if showDebtorNames is enabled.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      ownerId: true,
      isPublic: true,
      accessPassword: true,
      showDebtorNames: true,
      paymentEnforcementLevel: true,
      paymentGateThreshold: true,
    },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);

  if (event.accessPassword) {
    const isInvited = session?.user
      ? (await prisma.eventInvite.count({ where: { eventId, userId: session.user.id } })) > 0
        || (await checkEventAdmin(eventId, session.user.id))
      : false;
    const access = checkAccess({
      eventOwnerId: event.ownerId,
      accessPassword: event.accessPassword,
      requestUserId: session?.user?.id ?? null,
      cookieHeader: request.headers.get("cookie"),
      eventId,
      isInvited,
    });
    if (!access.granted) {
      return Response.json({ error: "Access denied." }, { status: 403 });
    }
  }
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  const isPrivileged = isOwner || isAdmin;

  // Find the caller's player name in this event
  let callerBalance = null;
  let callerGateAmount: number | null = null;
  if (session?.user) {
    const player = await prisma.player.findFirst({
      where: { eventId, userId: session.user.id },
      select: { name: true },
    });
    if (player) {
      callerBalance = await getOutstandingBalance(eventId, player.name);
      // Same gate-balance input the join path feeds decidePaymentGate — lets
      // the client's Quick Join mirror share the server's decision exactly.
      callerGateAmount = await getGateBalance(eventId, player.name);
    }
  }

  const summary = await getEventBalanceSummary(eventId);

  // Filter balances based on visibility rules
  let balances = summary.balances;
  if (!isPrivileged && !event.showDebtorNames) {
    // Strip individual names — only return caller's own if present
    balances = callerBalance && callerBalance.amount > 0 ? [callerBalance] : [];
  }

  return Response.json({
    enforcement: event.paymentEnforcementLevel,
    threshold: event.paymentGateThreshold,
    callerBalance,
    gateAmount: callerGateAmount,
    aggregate: { paidCount: summary.paidCount, totalCount: summary.totalCount },
    balances,
  });
};
