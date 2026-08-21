import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { enqueueNotification, drainNotificationQueue } from "../../../../lib/notificationQueue.server";

/**
 * POST — adopt an Open Pickup (ADR-0021).
 * Any authenticated user may take over an unowned pickup; the event stays public
 * by default and the new Owner configures privacy via the normal event settings.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  if (event.source !== "playtomic") {
    return Response.json({ error: "This event is not an open pickup." }, { status: 409 });
  }

  // Atomic claim — only succeeds if the pickup is still unowned.
  const claimed = await prisma.event.updateMany({
    where: { id: eventId, ownerId: null, source: "playtomic" },
    data: { ownerId: session.user.id, adoptedAt: new Date() },
  });

  if (claimed.count === 0) {
    return Response.json({ error: "This pickup already has an owner." }, { status: 409 });
  }

  // Notify followers (including anyone who joined) that the pickup was adopted.
  // event_details is an event-level type — all followers receive it (ADR 0017).
  await enqueueNotification(eventId, "event_details", {
    title: "Pickup adopted",
    key: "notifyPickupAdopted",
    params: {
      name: session.user.name ?? "Someone",
      club: event.playtomicTenantName ?? event.title,
    },
    url: `/events/${eventId}`,
    spotsLeft: event.maxPlayers,
  });
  await drainNotificationQueue().catch(() => {});

  return Response.json({ ok: true, eventId, ownerId: session.user.id });
};
