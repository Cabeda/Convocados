import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../lib/auth.helpers.server";
import { getLedgerForUser } from "../../../../lib/payments.server";
import { computeAvailableUnits, computeAvailableUnitsDetailed } from "../../../../lib/wallet";
import { subscriptionWindowFor } from "../../../../lib/monthly";
import {
  getOutstandingBalance,
  getEventBalanceSummary,
} from "../../../../lib/balance.server";

/**
 * GET /api/events/[id]/settle
 *
 * Returns the full Settle Up payload for the caller. Owner/Admin get the
 * full admin view; players get their own balance + activity + the public
 * extras pot; unauthenticated callers get the public extras pot only.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { eventCost: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  const isPrivileged = isOwner || isAdmin;

  // Public: extras pot
  const extrasPot = event.eventCost?.organizerExtrasCents ?? 0;
  const extrasDeclarations = await prisma.extrasDeclaration.findMany({
    where: { eventId },
    orderBy: { declaredAt: "desc" },
  });

  const response: {
    event: Record<string, unknown>;
    extras: Record<string, unknown>;
    you?: Record<string, unknown>;
    admin?: Record<string, unknown>;
  } = {
    event: {
      id: event.id,
      title: event.title,
      timezone: event.timezone,
      currency: event.eventCost?.currency ?? "EUR",
      monthlyEnabled: event.eventCost?.monthlyEnabled ?? false,
      monthlyFeeCents: event.eventCost?.monthlyFeeCents ?? null,
      monthlyGamesCovered: event.eventCost?.monthlyGamesCovered ?? 5,
      dropInSurchargeCents: event.eventCost?.dropInSurchargeCents ?? 0,
    },
    extras: {
      potCents: extrasPot,
      currency: event.eventCost?.currency ?? "EUR",
      declarations: extrasDeclarations.map((d) => ({
        id: d.id,
        amountCents: d.amountCents,
        currency: d.currency,
        label: d.label,
        declaredBy: d.declaredBy,
        declaredAt: d.declaredAt.toISOString(),
      })),
    },
  };

  if (session?.user) {
    // Per-user view: wallet, balance, history
    const myPlayer = await prisma.player.findFirst({
      where: { eventId, userId: session.user.id },
      select: { name: true },
    });

    if (myPlayer) {
      const balance = await getOutstandingBalance(eventId, myPlayer.name);
      const txs = await getLedgerForUser(eventId, session.user.id);
      const txRows = txs.map((t) => ({
        id: t.id,
        reason: t.reason,
        direction: t.direction,
        amountCents: t.amountCents,
        currency: t.currency,
        gameUnits: t.gameUnits,
        statusAfter: t.statusAfter,
        eventInstanceId: t.eventInstanceId,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      }));
      const detail = computeAvailableUnitsDetailed(
        txs.map((t) => ({
          direction: t.direction as "debit" | "credit",
          reason: t.reason as "per_game_share" | "monthly_fee" | "missed_game_credit" | "credit_redeemed" | "credit_expired" | "extras_declare" | "payment_received" | "payment_self_reported",
          gameUnits: t.gameUnits,
          amountCents: t.amountCents,
          createdAt: t.createdAt,
          eventInstanceId: t.eventInstanceId,
          idempotencyKey: t.idempotencyKey,
        })),
      );
      response.you = {
        playerName: myPlayer.name,
        balanceCents: Math.round(balance.amount * 100),
        gamesOwed: balance.gamesOwed,
        streak: balance.streak,
        availableGameUnits: computeAvailableUnits(
          txs.map((t) => ({
            direction: t.direction as "debit" | "credit",
            reason: t.reason as "per_game_share" | "monthly_fee" | "missed_game_credit" | "credit_redeemed" | "credit_expired" | "extras_declare" | "payment_received" | "payment_self_reported",
            gameUnits: t.gameUnits,
            amountCents: t.amountCents,
            createdAt: t.createdAt,
            eventInstanceId: t.eventInstanceId,
            idempotencyKey: t.idempotencyKey,
          })),
        ),
        transactions: txRows,
        walletRunningTotal: detail.total,
      };

      // Active subscription for the current month?
      const now = new Date();
      const window = subscriptionWindowFor(now, event.timezone || "UTC");
      const sub = await prisma.monthlySubscription.findUnique({
        where: {
          eventId_userId_windowStart: { eventId, userId: session.user.id, windowStart: window.windowStart },
        },
      });
      response.you.activeSubscription = sub
        ? {
            id: sub.id,
            mode: sub.mode,
            windowStart: sub.windowStart.toISOString(),
            windowEnd: sub.windowEnd.toISOString(),
            feeCents: sub.feeCents,
            gamesCovered: sub.gamesCovered,
            status: sub.status,
          }
        : null;
    }
  }

  if (isPrivileged) {
    const summary = await getEventBalanceSummary(eventId);
    response.admin = {
      balances: summary.balances,
      aggregate: { paidCount: summary.paidCount, totalCount: summary.totalCount },
      // List of active subscriptions for the current window
      subscriptions: (await prisma.monthlySubscription.findMany({
        where: { eventId, status: "active" },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      })).map((s) => ({
        id: s.id,
        userId: s.userId,
        userName: s.user.name,
        mode: s.mode,
        windowStart: s.windowStart.toISOString(),
        windowEnd: s.windowEnd.toISOString(),
        feeCents: s.feeCents,
        gamesCovered: s.gamesCovered,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  return Response.json(response);
};

// Allow POST on this route? No — keep GET only.
export const POST: APIRoute = async () =>
  Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
