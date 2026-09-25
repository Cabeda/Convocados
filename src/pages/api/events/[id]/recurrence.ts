import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { serializeRecurrenceRule, type RecurrenceRule } from "../../../../lib/recurrence";
import { getDefaultDurationMinutes } from "../../../../lib/sports";

const VALID_FREQS = ["daily", "weekly", "monthly", "yearly"] as const;

/**
 * Change an Event's recurrence after creation — the "repeat this game / make it
 * recurring" action offered to the Owner once a Game has been played.
 *
 * Recurrence was previously settable only at creation, so finishing a one-off
 * Game left no path to "same again next week" short of recreating the Event.
 */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const isRecurring = Boolean(body.isRecurring);

  if (!isRecurring) {
    await prisma.event.update({
      where: { id: event.id },
      data: { isRecurring: false, recurrenceRule: null, nextResetAt: null },
    });
    return Response.json({ isRecurring: false, recurrenceRule: null, nextResetAt: null });
  }

  const rawFreq = body.recurrenceFreq ?? null;
  if (!rawFreq || !VALID_FREQS.includes(rawFreq)) {
    return Response.json(
      { error: "recurrenceFreq must be one of: " + VALID_FREQS.join(", ") },
      { status: 400 },
    );
  }

  const interval = parseInt(String(body.recurrenceInterval ?? "1"), 10);
  const byDay = typeof body.recurrenceByDay === "string" && body.recurrenceByDay.trim()
    ? body.recurrenceByDay.trim()
    : undefined;

  const rule: RecurrenceRule = {
    freq: rawFreq,
    interval: Number.isNaN(interval) || interval < 1 ? 1 : interval,
    ...(byDay ? { byDay } : {}),
  };

  const durationMinutes = event.durationMinutes || getDefaultDurationMinutes(event.sport);
  const nextResetAt = new Date(event.dateTime.getTime() + durationMinutes * 60_000);

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      isRecurring: true,
      recurrenceRule: serializeRecurrenceRule(rule),
      nextResetAt,
    },
  });

  return Response.json({
    isRecurring: true,
    recurrenceRule: updated.recurrenceRule,
    nextResetAt: updated.nextResetAt?.toISOString() ?? null,
  });
};
