import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { checkOwnership } from "../../../../../../lib/auth.helpers.server";

/** GET — list delivery logs for a webhook */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const webhookId = params.webhookId ?? "";

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { ownerId: true } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Delivery logs expose endpoint URLs and error details — owner/admin only.
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const webhook = await prisma.webhookSubscription.findFirst({
    where: { id: webhookId, eventId },
  });
  if (!webhook) return Response.json({ error: "Not found." }, { status: 404 });

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { webhookId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({
    deliveries: deliveries.map((d) => ({
      id: d.id,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      error: d.error,
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
      lastAttempt: d.lastAttempt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
  });
};
