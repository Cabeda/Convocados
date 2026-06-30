import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { enqueueNotification, drainNotificationQueue } from "~/lib/notificationQueue.server";

/** PUT — bulk mark all pending/sent payments as paid. Owner/Admin only. */
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

  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!eventCost) return Response.json({ error: "No cost set for this event." }, { status: 404 });

  // ADR 0017: Get players with pending payments before bulk update to notify them
  const pendingPayments = await prisma.playerPayment.findMany({
    where: { eventCostId: eventCost.id, status: { in: ["pending", "sent"] } },
    select: { playerName: true },
  });

  const result = await prisma.playerPayment.updateMany({
    where: {
      eventCostId: eventCost.id,
      status: { in: ["pending", "sent"] },
    },
    data: { status: "paid", paidAt: new Date() },
  });

  // ADR 0017: Notify each player whose payment was confirmed (via queue, respects tier + overrides)
  if (pendingPayments.length > 0) {
    const playerNames = pendingPayments.map((p) => p.playerName);
    const players = await prisma.player.findMany({
      where: { eventId, name: { in: playerNames }, userId: { not: null } },
      select: { userId: true },
    });
    for (const p of players) {
      if (!p.userId) continue;
      await enqueueNotification(eventId, "payment_confirmed", {
        title: event.title,
        key: "notifyPaymentConfirmed",
        params: { title: event.title },
        url: `/events/${eventId}?action=pay`,
        spotsLeft: 0,
      }, p.userId);
    }
    if (!process.env.VITEST) {
      await drainNotificationQueue().catch(() => {});
    }
  }

  return Response.json({ ok: true, updated: result.count });
};
