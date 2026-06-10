import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../lib/auth.helpers.server";
import { getOutstandingBalance, getEventBalanceSummary } from "../../../../lib/balance.server";

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
      showDebtorNames: true,
      paymentEnforcementLevel: true,
      paymentGateThreshold: true,
    },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  const isPrivileged = isOwner || isAdmin;

  // Find the caller's player name in this event
  let callerBalance = null;
  if (session?.user) {
    const player = await prisma.player.findFirst({
      where: { eventId, userId: session.user.id },
      select: { name: true },
    });
    if (player) {
      callerBalance = await getOutstandingBalance(eventId, player.name);
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
    aggregate: { paidCount: summary.paidCount, totalCount: summary.totalCount },
    balances,
  });
};
