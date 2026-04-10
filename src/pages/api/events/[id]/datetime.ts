import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { enqueueNotification, drainNotificationQueue } from "../../../../lib/notificationQueue.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin, session } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();

  const dateTimeRaw = body.dateTime !== undefined ? String(body.dateTime) : null;
  const timezoneRaw = body.timezone !== undefined ? String(body.timezone).trim().slice(0, 100) : null;

  const updates: { dateTime?: Date; timezone?: string } = {};

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

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  await prisma.event.update({ where: { id: params.id as string }, data: updates });

  const eventId = params.id as string;
  const actor = session?.user?.name ?? null;
  const actorId = session?.user?.id ?? null;

  await prisma.eventLog.create({
    data: {
      eventId,
      action: "event_updated",
      actor,
      actorId,
      details: JSON.stringify({
        fields: Object.keys(updates),
        timezone: updates.timezone ?? (event as any).timezone ?? "UTC",
      }),
    },
  });

  // Notify subscribers if dateTime changed
  if (updates.dateTime) {
    const activePlayers = await prisma.player.count({ where: { eventId, archivedAt: null } });
    const spotsLeft = Math.max(0, event.maxPlayers - activePlayers);
    const url = `/events/${eventId}`;
    await enqueueNotification(eventId, "event_details", {
      title: event.title,
      key: "notifyEventDetailsChanged" as const,
      params: {},
      url,
      spotsLeft,
    });

    // Drain notification queue immediately so push is sent in near-real-time
    drainNotificationQueue().catch(() => {});
  }

  return Response.json({
    ok: true,
    dateTime: updates.dateTime ? updates.dateTime.toISOString() : undefined,
    timezone: updates.timezone,
  });
};
