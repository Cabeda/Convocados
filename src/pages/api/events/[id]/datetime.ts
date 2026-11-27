import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { cancelEventJobs, scheduleEventReminders } from "../../../../lib/scheduler.server";
import { announceEventDetailsChange } from "../../../../lib/eventDetailsAnnouncement.server";
import {
  anchorDayOf,
  parseRecurrenceRule,
  serializeRecurrenceRule,
} from "../../../../lib/recurrence";

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

  const dateTimeRaw = body.dateTime !== undefined ? String(body.dateTime) : null;
  const timezoneRaw = body.timezone !== undefined ? String(body.timezone).trim().slice(0, 100) : null;

  const updates: { dateTime?: Date; timezone?: string; recurrenceRule?: string } = {};

  if (dateTimeRaw !== null) {
    const dateTime = new Date(dateTimeRaw);
    if (isNaN(dateTime.getTime())) {
      return Response.json({ error: "Invalid date/time." }, { status: 400 });
    }
    updates.dateTime = dateTime;
  }

  if (timezoneRaw !== null) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezoneRaw });
    } catch {
      return Response.json({ error: "Invalid timezone." }, { status: 400 });
    }
    updates.timezone = timezoneRaw;
  }

  // A reschedule that changes the day moves the series occurrence (same as
  // before #1788). A time- or timezone-only edit must NOT re-anchor from a
  // clamped occurrence: a 31st series sitting on Feb 28 would otherwise
  // silently become a 28th series.
  const existingRule = parseRecurrenceRule(event.recurrenceRule);
  if (
    (updates.dateTime || updates.timezone) &&
    existingRule &&
    (existingRule.freq === "monthly" || existingRule.freq === "yearly")
  ) {
    const currentDay = anchorDayOf(event.dateTime, event.timezone ?? "UTC");
    const editedDay = anchorDayOf(
      updates.dateTime ?? event.dateTime,
      updates.timezone ?? event.timezone ?? "UTC",
    );
    const nextAnchor = editedDay === currentDay ? (existingRule.anchorDay ?? currentDay) : editedDay;
    if (nextAnchor !== existingRule.anchorDay) {
      updates.recurrenceRule = serializeRecurrenceRule({
        ...existingRule,
        anchorDay: nextAnchor,
      });
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  await prisma.event.update({ where: { id: params.id as string }, data: updates });

  // Reschedule reminder jobs if dateTime changed
  const eventId = params.id as string;
  if (updates.dateTime) {
    const updatedEvent = await prisma.event.findUnique({ where: { id: eventId } });
    if (updatedEvent) {
      await cancelEventJobs(eventId);
      try {
        await scheduleEventReminders(eventId, updatedEvent.dateTime, updatedEvent.durationMinutes);
      } catch {
        // ignore scheduling failures
      }
    }
  }
  const actor = authz.session?.user?.name ?? null;
  const actorId = authz.session?.user?.id ?? null;

  await prisma.eventLog.create({
    data: {
      eventId,
      action: "event_updated",
      actor,
      actorId,
      details: JSON.stringify({
        fields: Object.keys(updates),
        timezone: updates.timezone ?? event.timezone ?? "UTC",
      }),
    },
  });

  // Notify subscribers only if dateTime actually changed
  const dateTimeActuallyChanged = updates.dateTime && updates.dateTime.getTime() !== event.dateTime.getTime();
  if (dateTimeActuallyChanged) {
    await announceEventDetailsChange(event, authz.session?.user?.id);
  }

  return Response.json({
    ok: true,
    dateTime: updates.dateTime ? updates.dateTime.toISOString() : undefined,
    timezone: updates.timezone,
  });
};
