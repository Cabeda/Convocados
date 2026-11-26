import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { activeParticipantsWhere } from "../../../../lib/activeParticipants.server";

/** PUT — reorder players. Authorization is the shared event-mutation seam (ADR 0035). */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Owner, admin, or an ownerless unlisted event (ADR 0035)
  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return Response.json({ error: "Only the event owner can reorder players." }, { status: 403 });
  }

  const { playerIds } = await request.json();
  if (!Array.isArray(playerIds)) {
    return Response.json({ error: "playerIds must be an array." }, { status: 400 });
  }

  // ADR 0016: the current game's GameParticipant rows are the roster, and GET
  // returns EventPlayer ids — not the legacy Player ids. Reorder through the
  // shared active-roster filter so a departed (archived) row cannot make the
  // exact-set check reject every live reorder.
  if (event.currentGameId) {
    const participants = await prisma.gameParticipant.findMany({
      where: activeParticipantsWhere(event.currentGameId),
      select: { id: true, eventPlayerId: true },
      orderBy: { order: "asc" },
    });
    const byEventPlayerId = new Map(participants.map((p) => [p.eventPlayerId, p.id]));

    if (playerIds.length !== participants.length || !playerIds.every((id: string) => byEventPlayerId.has(id))) {
      return Response.json({ error: "playerIds must contain exactly the current players." }, { status: 400 });
    }

    await prisma.$transaction(
      playerIds.map((id: string, i: number) =>
        prisma.gameParticipant.update({ where: { id: byEventPlayerId.get(id)! }, data: { order: i } })
      )
    );

    return Response.json({ ok: true });
  }

  // Legacy events with no current game: Player rows are the roster.
  const currentIds = new Set(event.players.map((p) => p.id));
  if (playerIds.length !== currentIds.size || !playerIds.every((id: string) => currentIds.has(id))) {
    return Response.json({ error: "playerIds must contain exactly the current players." }, { status: 400 });
  }

  await prisma.$transaction(
    playerIds.map((id: string, i: number) =>
      prisma.player.update({ where: { id }, data: { order: i } })
    )
  );

  return Response.json({ ok: true });
};
