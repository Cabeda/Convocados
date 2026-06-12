import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { subscriptionWindowFor } from "../../../../../lib/monthly";
import { addEnrollment } from "../../../../../lib/priority.server";

/**
 * POST /api/events/[id]/settle/subscriptions
 *   Owner/Admin marks a user as subscribed for a given calendar month.
 *   Body: { userId: string, windowStart?: string (ISO) }
 *   If windowStart is omitted, the current month (in the event's timezone) is used.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { eventCost: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can manage subscriptions." }, { status: 403 });
  }
  if (!event.eventCost?.monthlyEnabled) {
    return Response.json({ error: "Monthly subscriptions are not enabled for this event." }, { status: 400 });
  }

  const body = await request.json();
  const userId = String(body.userId ?? "").trim();
  if (!userId) return Response.json({ error: "userId is required." }, { status: 400 });

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) return Response.json({ error: "User not found." }, { status: 404 });

  // Resolve the subscription window
  const tz = event.timezone || "UTC";
  const referenceDate = body.windowStart ? new Date(String(body.windowStart)) : new Date();
  if (Number.isNaN(referenceDate.getTime())) {
    return Response.json({ error: "Invalid windowStart." }, { status: 400 });
  }
  const window = subscriptionWindowFor(referenceDate, tz);

  const sub = await prisma.monthlySubscription.upsert({
    where: { eventId_userId_windowStart: { eventId, userId, windowStart: window.windowStart } },
    create: {
      eventId,
      userId,
      mode: "monthly",
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      feeCents: event.eventCost.monthlyFeeCents ?? 0,
      gamesCovered: event.eventCost.monthlyGamesCovered,
      status: "active",
      markedById: session?.user?.id ?? null,
    },
    update: {
      status: "active",
      markedById: session?.user?.id ?? null,
    },
  });

  // Per ADR 0008: monthly subscribers are auto-enrolled in PriorityEnrollment
  // (still subject to eligibility rules at enrollment time — attendance
  // threshold, no-show streak — but the monthly payment qualifies them).
  try {
    await addEnrollment(eventId, userId, "auto");
  } catch {
    // Non-fatal: priority enrollment is an optimization, not a requirement.
  }

  return Response.json({
    ok: true,
    subscription: {
      id: sub.id,
      userId: sub.userId,
      mode: sub.mode,
      windowStart: sub.windowStart.toISOString(),
      windowEnd: sub.windowEnd.toISOString(),
      feeCents: sub.feeCents,
      gamesCovered: sub.gamesCovered,
      status: sub.status,
    },
  });
};
