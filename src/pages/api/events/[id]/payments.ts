import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { canReadEventFinances } from "../../../../lib/eventReadAccess.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { enqueueNotification, drainNotificationQueue } from "../../../../lib/notificationQueue.server";
import { recordSelfReported, recordReceived } from "../../../../lib/payments.server";
import { summarizePayments } from "../../../../lib/paymentSummary";

const VALID_STATUSES = ["pending", "sent", "paid"];

/** GET — list all payments with summary. Owner/admin/participant (or ownerless-unlisted link access). */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  if (!(await canReadEventFinances(request, event))) {
    return Response.json({ error: "Only event participants can view payments." }, { status: 403 });
  }

  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId },
    include: { payments: { orderBy: { playerName: "asc" } } },
  });

  if (!eventCost) {
    return Response.json({
      payments: [],
      summary: { paidCount: 0, pendingCount: 0, totalCount: 0, paidAmount: 0 },
    });
  }

  const payments = eventCost.payments;
  const { paidCount, pendingCount, totalCount, paidAmount } = summarizePayments(payments);

  return Response.json({
    payments: payments.map((p) => ({
      ...p,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    summary: {
      paidCount,
      pendingCount,
      totalCount,
      paidAmount,
    },
  });
};

/** PUT — update a player's payment status. */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  const session = await getSession(request);

  // Determine if this is a player self-reporting sent
  let isSelfReport = false;
  const body = await request.json();
  const playerName = String(body.playerName ?? "").trim();
  const status = String(body.status ?? "");

  if (session?.user && !authz.isOwner && !authz.isAdmin) {
    // Check if the player is linked to this user
    const linkedPlayer = await prisma.player.findFirst({
      where: { eventId, userId: session.user.id, name: playerName },
    });
    if (linkedPlayer && status === "sent") {
      // Allowed: player marking their own payment as sent
      isSelfReport = true;
    }
  }

  if (!authz.allowed && !isSelfReport) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!eventCost) return Response.json({ error: "No cost set for this event." }, { status: 404 });

  // method semantics: absent (undefined) → leave unchanged; explicit null → clear;
  // a string → set (trimmed, capped). Previously `String(body.method)` on an
  // absent field produced the literal string "undefined".
  const method = body.method === undefined
    ? undefined
    : body.method === null
      ? null
      : String(body.method).trim().slice(0, 50) || null;

  if (!VALID_STATUSES.includes(status)) {
    return Response.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const payment = await prisma.playerPayment.findUnique({
    where: { eventCostId_playerName: { eventCostId: eventCost.id, playerName } },
  });
  if (!payment) return Response.json({ error: "Player payment not found." }, { status: 404 });

  // Self-report can only move pending → sent
  if (isSelfReport && payment.status !== "pending") {
    return Response.json({ error: "Can only mark as sent when status is pending." }, { status: 400 });
  }

  const updated = await prisma.playerPayment.update({
    where: { id: payment.id },
    data: {
      status,
      paidAt: status === "paid" ? new Date() : null,
      ...(method !== undefined && { method }),
    },
  });

  // ADR 0016 dual-write (5rhgs71k): readers consume the occurrence GamePayment
  // roll, so the legacy writer must mirror status/method/paidAt onto the live
  // game's row. Contract 756nurms removes the PlayerPayment side.
  if (event.currentGameId) {
    await prisma.gamePayment.updateMany({
      where: { gameId: event.currentGameId, playerName },
      data: {
        status,
        paidAt: status === "paid" ? new Date() : null,
        ...(method !== undefined && { method }),
      },
    });
  }

  // ADR 0019: Write ledger row alongside PlayerPayment update
  if (isSelfReport && status === "sent" && session?.user) {
    await recordSelfReported({ eventId, userId: session.user.id, playerName });
  } else if (status === "paid" && !isSelfReport) {
    const markedById = session?.user?.id ?? event.ownerId ?? "unknown";
    await recordReceived({ eventId, playerName, markedById });
  }

  // ADR 0017: Notify the player when their payment is confirmed (via queue, respects tier + overrides)
  if (status === "paid" && !isSelfReport) {
    const player = await prisma.player.findFirst({
      where: { eventId, name: playerName, userId: { not: null } },
      select: { userId: true },
    });
    if (player?.userId) {
      await enqueueNotification(eventId, "payment_confirmed", {
        title: event.title,
        key: "notifyPaymentConfirmed",
        params: { title: event.title },
        url: `/events/${eventId}?action=pay`,
        spotsLeft: 0,
      }, player.userId);
      if (!process.env.VITEST) {
        await drainNotificationQueue().catch(() => {});
      }
    }
  }

  // ADR 0018: Notify organizer when a player self-reports payment (critical break-through)
  if (isSelfReport && event.ownerId) {
    await enqueueNotification(eventId, "payment_self_reported", {
      title: event.title,
      key: "notifyPaymentSelfReported",
      params: { player: playerName, title: event.title },
      url: `/events/${eventId}?action=confirm-payment&player=${encodeURIComponent(playerName)}`,
      spotsLeft: 0,
    });
    if (!process.env.VITEST) {
      await drainNotificationQueue().catch(() => {});
    }
  }


  return Response.json({
    ...updated,
    paidAt: updated.paidAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
};
