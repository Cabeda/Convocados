import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { confirmSpot } from "../../../../../lib/priority.server";
import { grantActiveSpot } from "../../../../../lib/game.server";
import { addPlayerToTeams, validateTeams } from "../players";

/** POST — player confirms their priority spot */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, dateTime: true, currentGameId: true, maxPlayers: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const result = await confirmSpot(event.id, session.user.id, event.dateTime);
  if (!result) return Response.json({ error: "No pending confirmation found." }, { status: 404 });

  if (result.status === "confirmed") {
    // Auto-add player to the event if not already there
    const existingPlayer = await prisma.player.findFirst({
      where: { eventId: event.id, userId: session.user.id },
    });
    if (!existingPlayer) {
      const maxOrder = await prisma.player.aggregate({
        where: { eventId: event.id },
        _max: { order: true },
      });
      await prisma.player.create({
        data: {
          eventId: event.id,
          name: session.user.name,
          userId: session.user.id,
          order: (maxOrder._max.order ?? -1) + 1,
        },
      });
    }

    // ADR 0016/0020: guaranteed active spot via GameParticipant. Confirming a
    // priority spot always yields an active slot — if the game is full, the
    // last non-priority active player is evicted to the bench.
    if (event.currentGameId) {
      const eventPlayer = await prisma.eventPlayer.upsert({
        where: { eventId_name: { eventId: event.id, name: session.user.name } },
        create: { eventId: event.id, name: session.user.name, userId: session.user.id },
        update: {},
      });
      const result = await grantActiveSpot(
        event.id,
        event.currentGameId,
        eventPlayer.id,
        event.maxPlayers,
      );
      // Resync teams after the roster changed (eviction or promotion).
      await validateTeams(event.id, event.maxPlayers, event.currentGameId);
      if (result.active) {
        await addPlayerToTeams(event.id, session.user.name, event.currentGameId);
      }
    }
  }

  return Response.json({ ok: true, status: result.status });
};
