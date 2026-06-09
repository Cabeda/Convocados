import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { enqueueNotification, drainNotificationQueue } from "~/lib/notificationQueue.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("switch-court");

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { players: { where: { archivedAt: null } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only event owner or admins can switch courts." }, { status: 403 });
  }

  const body = await request.json();
  const { location, latitude, longitude, dateTime } = body;

  if (!location || typeof location !== "string") {
    return Response.json({ error: "Location is required." }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {
    location: location.slice(0, 200),
    latitude: typeof latitude === "number" ? latitude : event.latitude,
    longitude: typeof longitude === "number" ? longitude : event.longitude,
    courtWatchConfig: null, // disable watching after switch
  };

  // Only update dateTime if explicitly provided (admin confirmed the time change)
  if (dateTime) {
    const parsed = new Date(dateTime);
    if (!isNaN(parsed.getTime())) {
      updateData.dateTime = parsed;
    }
  }

  await prisma.event.update({ where: { id: params.id }, data: updateData });

  // Notify all followers about the location change
  const activePlayers = event.players.length;
  const spotsLeft = Math.max(0, event.maxPlayers - activePlayers);

  await enqueueNotification(event.id, "event_details", {
    title: event.title,
    key: "notifyEventDetailsChanged" as const,
    params: { title: event.title },
    url: `/events/${event.id}`,
    spotsLeft,
  });

  if (!process.env.VITEST) {
    await drainNotificationQueue().catch((err) => {
      log.error({ eventId: event.id, err }, "Failed to drain notification queue");
    });
  }

  return Response.json({ ok: true, location: updateData.location, dateTime: updateData.dateTime ?? event.dateTime });
};
