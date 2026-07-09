import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { enqueueNotification, drainNotificationQueue } from "~/lib/notificationQueue.server";

/**
 * POST /api/events/[id]/payments/remind
 *
 * Body: { playerName: string }
 *
 * Sends the existing `payment_reminder` push (Tier 2, ADR 0017) immediately
 * to the player, bypassing the 3-stage nudge escalation (CONTEXT.md
 * "Payment Nudge Escalation"). Admin-initiated reminder takes priority
 * over the automatic sequence. Owner/Admin only.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const playerName = String(body.playerName ?? "").trim();
  if (!playerName) {
    return Response.json({ error: "playerName is required." }, { status: 400 });
  }

  // Find the EventPlayer + linked User
  const eventPlayer = await prisma.eventPlayer.findUnique({
    where: { eventId_name: { eventId, name: playerName } },
    select: { userId: true },
  });
  if (!eventPlayer?.userId) {
    return Response.json({ error: "Player is not linked to a user account." }, { status: 404 });
  }

  await enqueueNotification(eventId, "payment_reminder", {
    title: event.title,
    key: "notifyPaymentReminder",
    params: { title: event.title, player: playerName },
    url: `/events/${eventId}?action=pay`,
    spotsLeft: 0,
  }, eventPlayer.userId);

  if (!process.env.VITEST) {
    await drainNotificationQueue().catch(() => {});
  }

  return Response.json({ ok: true });
};
