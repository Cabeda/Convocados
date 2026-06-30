import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../lib/eventLog.server";
import { enqueueNotification, drainNotificationQueue } from "../../../../lib/notificationQueue.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Owner-only — admins cannot archive
  const { isOwner, session } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (!isOwner) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const archive = Boolean(body.archive);

  const archivedAt = archive ? new Date() : null;

  // ADR 0017: Send game_cancelled notification BEFORE deleting follows (Tier 1 — all followers)
  if (archive) {
    await enqueueNotification(event.id, "game_cancelled", {
      title: event.title,
      key: "notifyGameCancelled",
      params: { title: event.title },
      url: `/events/${event.id}`,
      spotsLeft: 0,
    });
    await drainNotificationQueue();
  }

  await prisma.event.update({
    where: { id: params.id },
    data: { archivedAt },
  });

  if (archive) {
    await prisma.eventFollow.deleteMany({ where: { eventId: params.id } });
  }

  const action = archive ? "event_archived" : "event_unarchived";
  await logEvent(
    event.id,
    action,
    session?.user?.name ?? null,
    session?.user?.id ?? null,
  );


  return Response.json({ archivedAt: archivedAt?.toISOString() ?? null });
};
