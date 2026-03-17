import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { checkOwnership } from "../../../../../lib/auth.helpers.server";

const MAX_WEBHOOKS_PER_EVENT = 10;

/** POST — subscribe a webhook */
export const POST: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (event.ownerId && !isOwner) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const url = String(body.url ?? "").trim();
  if (!url) return Response.json({ error: "url is required." }, { status: 400 });

  try {
    new URL(url);
  } catch {
    return Response.json({ error: "Invalid URL." }, { status: 400 });
  }

  // Rate limit: max webhooks per event
  const count = await prisma.webhookSubscription.count({ where: { eventId } });
  if (count >= MAX_WEBHOOKS_PER_EVENT) {
    return Response.json({ error: `Maximum ${MAX_WEBHOOKS_PER_EVENT} webhooks per event.` }, { status: 429 });
  }

  const validEvents = ["player_joined", "player_left", "game_full", "game_reset"];
  const events: string[] = Array.isArray(body.events)
    ? body.events.filter((e: string) => validEvents.includes(e))
    : [];
  const secret = typeof body.secret === "string" ? body.secret : null;

  try {
    const webhook = await prisma.webhookSubscription.create({
      data: {
        eventId,
        url,
        secret,
        events: JSON.stringify(events),
      },
    });

    return Response.json({
      id: webhook.id,
      url: webhook.url,
      events: JSON.parse(webhook.events),
      createdAt: webhook.createdAt.toISOString(),
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return Response.json({ error: "Webhook already registered for this URL." }, { status: 409 });
    }
    throw e;
  }
};

/** GET — list webhooks for an event */
export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const webhooks = await prisma.webhookSubscription.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
  });

  return Response.json({
    webhooks: webhooks.map((w) => ({
      id: w.id,
      url: w.url,
      events: JSON.parse(w.events),
      createdAt: w.createdAt.toISOString(),
    })),
  });
};
