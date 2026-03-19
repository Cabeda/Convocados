import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { sseManager } from "../../../../lib/sse.server";

/** POST — transfer ownership to another authenticated player */
export const POST: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (!isOwner) {
    return Response.json({ error: "Only the event owner can transfer ownership." }, { status: 403 });
  }

  const body = await request.json();
  const targetUserId = String(body.targetUserId ?? "").trim();
  if (!targetUserId) {
    return Response.json({ error: "targetUserId is required." }, { status: 400 });
  }

  // Verify the target user is an authenticated player in this event
  const targetPlayer = event.players.find((p) => p.userId === targetUserId);
  if (!targetPlayer) {
    return Response.json({ error: "Target user must be an authenticated player in this event." }, { status: 400 });
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { ownerId: targetUserId },
  });

  sseManager.broadcast(eventId, "update", { action: "ownership_transferred" });

  return Response.json({ ok: true, ownerId: targetUserId });
};
