import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { syncGameParticipantOrder } from "../../../../lib/playerOrder.server";

/** PUT — reorder players. Owner-only — claim ownership first on ownerless events. */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
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

  // Validate that the provided IDs match the current player set exactly.
  // ADR 0016: the event GET returns EventPlayer ids, so resolve each id
  // independently — Player id first, else EventPlayer id via name-match
  // (same per-id fallback as DELETE players). Mixed arrays are accepted.
  if (playerIds.length !== event.players.length) {
    return Response.json({ error: "playerIds must contain exactly the current players." }, { status: 400 });
  }
  const playerById = new Map(event.players.map((p) => [p.id, p]));
  const playerByName = new Map(event.players.map((p) => [p.name, p]));
  const eps = await prisma.eventPlayer.findMany({
    where: { id: { in: playerIds }, eventId },
    select: { id: true, name: true },
  });
  const nameByEpId = new Map(eps.map((e) => [e.id, e.name]));
  const resolved = playerIds.map((id: string) =>
    playerById.get(id) ?? (nameByEpId.has(id) ? playerByName.get(nameByEpId.get(id)!) : undefined),
  );
  if (resolved.some((p) => !p) || new Set(resolved.map((p) => p!.id)).size !== event.players.length) {
    return Response.json({ error: "playerIds must contain exactly the current players." }, { status: 400 });
  }
  const ordered = resolved.map((p) => p!);

  // Update order for each player
  await prisma.$transaction(
    ordered.map((p, i) =>
      prisma.player.update({ where: { id: p.id }, data: { order: i } })
    )
  );

  // ADR 0016: mirror onto GameParticipant.order — the event GET renders that track.
  if (event.currentGameId) {
    await syncGameParticipantOrder(eventId, event.currentGameId, ordered.map((p) => p.name));
  }

  return Response.json({ ok: true });
};
