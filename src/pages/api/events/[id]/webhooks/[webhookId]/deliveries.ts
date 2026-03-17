import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";

/** GET — list delivery logs for a webhook */
export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id!;
  const webhookId = params.webhookId!;

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
