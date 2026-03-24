import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../lib/eventLog.server";
import { sseManager } from "../../../../lib/sse.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin, session } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner or admin can archive players." }, { status: 403 });
  }

  const body = await request.json();
  const { playerId, archive } = body as { playerId?: string; archive?: boolean };

  if (!playerId || typeof playerId !== "string") {
    return Response.json({ error: "playerId is required." }, { status: 400 });
  }

  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId },
  });
  if (!player) return Response.json({ error: "Player not found." }, { status: 404 });

  const archivedAt = archive ? new Date() : null;

  await prisma.player.update({
    where: { id: playerId },
    data: { archivedAt },
  });

  const action = archive ? "player_archived" : "player_unarchived";
  await logEvent(
    eventId,
    action,
    session?.user?.name ?? null,
    session?.user?.id ?? null,
    { playerName: player.name },
  );

  sseManager.broadcast(eventId, "update", { action });

  return Response.json({ archivedAt: archivedAt?.toISOString() ?? null });
};
