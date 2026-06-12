import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../../lib/auth.helpers.server";

/**
 * GET /api/events/[id]/settle/transactions
 *
 * Returns the per-Event WalletTransaction ledger. Optional query params:
 *   userId   — filter to a single user (admin only)
 *   reason   — filter to one of the WalletTx reasons
 *   from, to — ISO date range filter on createdAt
 *
 * Auth:
 *   - Unauthenticated: 401
 *   - Authenticated player: only their own transactions
 *   - Owner/Admin: any filter
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  const isPrivileged = isOwner || isAdmin;

  const url = new URL(request.url);
  const userIdParam = url.searchParams.get("userId");
  const reasonParam = url.searchParams.get("reason");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  // Non-privileged callers can only see their own ledger.
  const userId = isPrivileged && userIdParam ? userIdParam : session.user.id;

  const txs = await prisma.walletTransaction.findMany({
    where: {
      eventId,
      userId,
      ...(reasonParam ? { reason: reasonParam } : {}),
      ...(fromParam ? { createdAt: { gte: new Date(fromParam) } } : {}),
      ...(toParam ? { createdAt: { lte: new Date(toParam) } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({
    transactions: txs.map((t) => ({
      id: t.id,
      userId: t.userId,
      reason: t.reason,
      direction: t.direction,
      amountCents: t.amountCents,
      currency: t.currency,
      gameUnits: t.gameUnits,
      statusAfter: t.statusAfter,
      eventInstanceId: t.eventInstanceId,
      subscriptionId: t.subscriptionId,
      extrasId: t.extrasId,
      markedById: t.markedById,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    })),
  });
};
