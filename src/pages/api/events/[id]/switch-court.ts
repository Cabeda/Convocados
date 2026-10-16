import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { authorizeEventMutation } from "~/lib/eventAuthz.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { enqueueNotification, drainNotificationQueue } from "~/lib/notificationQueue.server";
import { fireWebhooks } from "~/lib/webhook.server";
import { createLogger } from "~/lib/logger.server";
import { getRosterCapacity } from "~/lib/roster.server";

const log = createLogger("switch-court");

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({
    where: { id: params.id },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
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

  // Fire game_rescheduled webhook (non-blocking) — lean fact, client re-fetches state
  fireWebhooks(event.id, "game_rescheduled", {}).catch(() => {});

  // Notify all followers about the location change
  // ADR 0016: spotsLeft from the game-scoped roster (legacy Player rows
  // accumulate across recurring occurrences and would wrongly read 0).
  const { spotsLeft } = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

  await enqueueNotification(event.id, "event_details", {
    title: event.title,
    key: "notifyEventDetailsChanged" as const,
    params: { title: event.title },
    url: `/events/${event.id}`,
    spotsLeft,
  }, authz.session?.user?.id);

  if (!process.env.VITEST) {
    await drainNotificationQueue().catch((err) => {
      log.error({ eventId: event.id, err }, "Failed to drain notification queue");
    });
  }

  return Response.json({ ok: true, location: updateData.location, dateTime: updateData.dateTime ?? event.dateTime });
};
