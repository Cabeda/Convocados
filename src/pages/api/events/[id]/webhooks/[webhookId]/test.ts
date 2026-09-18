import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { signPayload } from "../../../../../../lib/webhook.server";
import { checkOwnership } from "../../../../../../lib/auth.helpers.server";
import { validateWebhookUrl } from "../../../../../../lib/webhookUrl";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";

/** POST — send a test payload to a webhook */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const eventId = params.id ?? "";
  const webhookId = params.webhookId ?? "";

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true, isPublic: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Test fires a server-side request to the stored URL, so it is organizer-only.
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (!isOwner && !isAdmin && (event.ownerId || event.isPublic)) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const webhook = await prisma.webhookSubscription.findFirst({
    where: { id: webhookId, eventId },
  });
  if (!webhook) return Response.json({ error: "Not found." }, { status: 404 });

  // Re-validate before fetching — rows may predate the create-time guard.
  const urlError = validateWebhookUrl(webhook.url);
  if (urlError) return Response.json({ error: urlError }, { status: 400 });

  const payload = JSON.stringify({
    event: "test",
    eventId,
    deliveryId: `test-${Date.now()}`,
    timestamp: new Date().toISOString(),
    data: { message: "This is a test webhook delivery from Convocados." },
  });

  const delivery = await prisma.webhookDelivery.create({
    data: { webhookId, eventType: "test", payload, status: "pending" },
  });

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Convocados-Webhook/1.0",
    };
    if (webhook.secret) {
      headers["X-Webhook-Signature"] = signPayload(payload, webhook.secret);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "success", attempts: 1, deliveredAt: new Date(), lastAttempt: new Date() },
      });
    } else {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "failed", attempts: 1, lastAttempt: new Date(), error: `HTTP ${res.status}` },
      });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? (err.name === "AbortError" ? "Timeout" : err.message) : "Unknown error";
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", attempts: 1, lastAttempt: new Date(), error: errMsg },
    });
  }

  const updated = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } });
  if (!updated) return Response.json({ error: "Not found." }, { status: 404 });

  return Response.json({
    delivery: {
      id: updated.id,
      eventType: updated.eventType,
      status: updated.status,
      error: updated.error,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    },
  });
};
