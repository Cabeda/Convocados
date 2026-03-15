import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { sendPushToEvent } from "../../../../lib/push.server";
import { fireWebhooks } from "../../../../lib/webhook.server";

export const POST: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.fly.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const senderClientId = request.headers.get("x-client-id") ?? undefined;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { createdAt: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { name } = await request.json();
  const trimmed = String(name ?? "").trim().slice(0, 50);
  if (!trimmed) return Response.json({ error: "Player name is required." }, { status: 400 });

  try {
    await prisma.player.create({ data: { name: trimmed, eventId } });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return Response.json({ error: `"${trimmed}" is already in the list.` }, { status: 409 });
    }
    throw e;
  }

  // spotsLeft after adding: if going to bench, active count unchanged
  const activeBefore = Math.min(event.players.length, event.maxPlayers);
  const isOnBench = event.players.length >= event.maxPlayers;
  const spotsLeft = isOnBench ? 0 : Math.max(0, event.maxPlayers - activeBefore - 1);
  const url = `${origin}/events/${eventId}`;

  if (isOnBench) {
    await sendPushToEvent(eventId, event.title, "notifyPlayerJoinedBench", { name: trimmed }, url, spotsLeft, senderClientId);
  } else {
    await sendPushToEvent(eventId, event.title, "notifyPlayerJoined", { name: trimmed }, url, spotsLeft, senderClientId);
  }

  // Fire webhooks (non-blocking)
  const webhookData = { playerName: trimmed, isActive: !isOnBench, spotsLeft };
  fireWebhooks(eventId, "player_joined", webhookData).catch(() => {});
  if (spotsLeft === 0) {
    fireWebhooks(eventId, "game_full", webhookData).catch(() => {});
  }

  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.fly.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const senderClientId = request.headers.get("x-client-id") ?? undefined;
  const { playerId } = await request.json();

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { createdAt: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const playerIndex = event.players.findIndex((p) => p.id === playerId);
  const player = event.players[playerIndex];
  if (!player) return Response.json({ error: "Not found." }, { status: 404 });

  const wasActive = playerIndex < event.maxPlayers;
  const firstBench = event.players[event.maxPlayers];

  await prisma.player.delete({ where: { id: playerId, eventId } });

  // spotsLeft after removal
  const activeAfter = wasActive
    ? firstBench ? event.maxPlayers : Math.min(event.players.length - 1, event.maxPlayers)
    : Math.min(event.players.length - 1, event.maxPlayers);
  const spotsLeft = Math.max(0, event.maxPlayers - activeAfter);

  const url = `${origin}/events/${eventId}`;
  if (!wasActive) {
    await sendPushToEvent(eventId, event.title, "notifyPlayerLeftBench", { name: player.name }, url, spotsLeft, senderClientId);
  } else if (firstBench) {
    await sendPushToEvent(eventId, event.title, "notifyPlayerLeftPromoted", { left: player.name, promoted: firstBench.name }, url, spotsLeft, senderClientId);
  } else {
    await sendPushToEvent(eventId, event.title, "notifyPlayerLeft", { name: player.name }, url, spotsLeft, senderClientId);
  }

  // Fire webhooks (non-blocking)
  fireWebhooks(eventId, "player_left", { playerName: player.name, spotsLeft }).catch(() => {});

  return Response.json({ ok: true });
};
