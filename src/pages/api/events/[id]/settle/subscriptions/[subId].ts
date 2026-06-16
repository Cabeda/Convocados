import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";

/**
 * DELETE /api/events/[id]/settle/subscriptions/[subId]
 *   Owner/Admin cancels an active subscription. No refund; the
 *   already-attended games remain covered. Future missed games in the
 *   window no longer earn credit.
 */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const subId = params.subId ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can cancel subscriptions." }, { status: 403 });
  }

  const sub = await prisma.monthlySubscription.findUnique({ where: { id: subId } });
  if (!sub || sub.eventId !== eventId) {
    return Response.json({ error: "Subscription not found." }, { status: 404 });
  }

  await prisma.monthlySubscription.update({
    where: { id: subId },
    data: { status: "cancelled" },
  });

  return Response.json({ ok: true });
};
