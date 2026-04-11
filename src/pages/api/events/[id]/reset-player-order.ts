import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { validateTeams } from "./players";

/** POST — reset player order to original signup order (createdAt). Owner-only. */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (!isOwner && !isAdmin) return Response.json({ error: "Only the event owner can reset player order." }, { status: 403 });

  const players = await prisma.player.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } });

  // Reset player order
  await prisma.$transaction(
    players.map((p, i) => prisma.player.update({ where: { id: p.id }, data: { order: i } }))
  );

  // Validate teams after order change — removes any bench players from teams
  const teamsCleared = await validateTeams(eventId, event.maxPlayers);

  if (teamsCleared) {
    return Response.json({
      ok: true,
      teamsCleared: true,
      message: "Player order reset. Teams have been updated because bench players were in active teams."
    });
  }

  return Response.json({ ok: true, teamsCleared: false });
};
