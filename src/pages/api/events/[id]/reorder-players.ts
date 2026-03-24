import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

/** PUT — reorder players. Owner-only — claim ownership first on ownerless events. */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Always require owner or admin
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can reorder players." }, { status: 403 });
  }

  const { playerIds } = await request.json();
  if (!Array.isArray(playerIds)) {
    return Response.json({ error: "playerIds must be an array." }, { status: 400 });
  }

  // Validate that the provided IDs match the current player set exactly
  const currentIds = new Set(event.players.map((p) => p.id));
  if (playerIds.length !== currentIds.size || !playerIds.every((id: string) => currentIds.has(id))) {
    return Response.json({ error: "playerIds must contain exactly the current players." }, { status: 400 });
  }

  // Update order for each player
  await prisma.$transaction(
    playerIds.map((id: string, i: number) =>
      prisma.player.update({ where: { id }, data: { order: i } })
    )
  );


  return Response.json({ ok: true });
};
