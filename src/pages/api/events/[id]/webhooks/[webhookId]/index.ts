import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";

import { authorizeEventMutation } from "../../../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { WEBHOOK_EVENT_TYPES } from "~/lib/webhookEvents";

const VALID_EVENTS: readonly string[] = WEBHOOK_EVENT_TYPES;

async function loadAuthorizedWebhook(eventId: string, webhookId: string, request: Request) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false as const, response: Response.json({ error: "Not found." }, { status: 404 }) };

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return { ok: false as const, response: Response.json({ error: "Only the event owner can do this." }, { status: 403 }) };
  }

  const webhook = await prisma.webhookSubscription.findFirst({
    where: { id: webhookId, eventId },
  });
  if (!webhook) return { ok: false as const, response: Response.json({ error: "Not found." }, { status: 404 }) };

  return { ok: true as const, webhook };
}

/** PATCH — update which events a webhook receives */
export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const eventId = params.id ?? "";
  const webhookId = params.webhookId ?? "";

  const authorized = await loadAuthorizedWebhook(eventId, webhookId, request);
  if (!authorized.ok) return authorized.response;

  const body = await request.json();

  const updateData: { events?: string; disabled?: boolean } = {};

  if (body.events !== undefined) {
    if (!Array.isArray(body.events)) {
      return Response.json({ error: "events is required." }, { status: 400 });
    }
    const invalid = body.events.filter((e: string) => !VALID_EVENTS.includes(e));
    if (invalid.length > 0) {
      return Response.json(
        { error: `Unknown event type(s): ${invalid.join(", ")}. Valid: ${VALID_EVENTS.join(", ")}` },
        { status: 400 },
      );
    }
    updateData.events = JSON.stringify(body.events);
  }

  if (body.disabled !== undefined) {
    if (typeof body.disabled !== "boolean") {
      return Response.json({ error: "disabled must be a boolean." }, { status: 400 });
    }
    updateData.disabled = body.disabled;
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const webhook = await prisma.webhookSubscription.update({
    where: { id: webhookId },
    data: updateData,
  });

  // Re-enabling resets the consecutive-failure streak so health checks do not
  // immediately re-disable the subscription on the next failed delivery.
  if (body.disabled === false) {
    await prisma.webhookDelivery.deleteMany({
      where: { webhookId, status: "failed" },
    });
  }

  return Response.json({
    id: webhook.id,
    url: webhook.url,
    events: JSON.parse(webhook.events),
    disabled: webhook.disabled,
  });
};

/** DELETE — unsubscribe a webhook */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const eventId = params.id ?? "";
  const webhookId = params.webhookId ?? "";

  const authorized = await loadAuthorizedWebhook(eventId, webhookId, request);
  if (!authorized.ok) return authorized.response;

  await prisma.webhookSubscription.delete({ where: { id: webhookId } });

  return Response.json({ ok: true });
};
