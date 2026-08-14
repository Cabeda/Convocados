import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { checkOwnership } from "../../../../../../lib/auth.helpers.server";

const VALID_EVENTS = ["player_joined", "player_left", "game_full", "game_reset"];

async function loadAuthorizedWebhook(eventId: string, webhookId: string, request: Request) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false as const, response: Response.json({ error: "Not found." }, { status: 404 }) };

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
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
  const eventId = params.id ?? "";
  const webhookId = params.webhookId ?? "";

  const authorized = await loadAuthorizedWebhook(eventId, webhookId, request);
  if (!authorized.ok) return authorized.response;

  const body = await request.json();
  if (!Array.isArray(body.events)) {
    return Response.json({ error: "events is required." }, { status: 400 });
  }

  const events: string[] = body.events.filter((e: string) => VALID_EVENTS.includes(e));
  const webhook = await prisma.webhookSubscription.update({
    where: { id: webhookId },
    data: { events: JSON.stringify(events) },
  });

  return Response.json({
    id: webhook.id,
    url: webhook.url,
    events: JSON.parse(webhook.events),
  });
};

/** DELETE — unsubscribe a webhook */
export const DELETE: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const webhookId = params.webhookId ?? "";

  const authorized = await loadAuthorizedWebhook(eventId, webhookId, request);
  if (!authorized.ok) return authorized.response;

  await prisma.webhookSubscription.delete({ where: { id: webhookId } });

  return Response.json({ ok: true });
};
