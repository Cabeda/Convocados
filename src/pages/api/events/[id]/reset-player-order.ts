import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { sseManager } from "../../../../lib/sse.server";

/** POST — reset player order to original signup order (createdAt). Owner-only. */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (!isOwner) return Response.json({ error: "Only the event owner can reset player order." }, { status: 403 });

  const players = await prisma.player.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } });

  // Reset player order
  await prisma.$transaction(
    players.map((p, i) => prisma.player.update({ where: { id: p.id }, data: { order: i } }))
  );

  // Check if teams exist and validate membership after order reset
  const existingTeams = await prisma.teamResult.findMany({
    where: { eventId },
    include: { members: true },
  });

  if (existingTeams.length > 0) {
    // Get updated player order
    const updatedPlayers = await prisma.player.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
    });

    // Check if any team members are bench players (order >= maxPlayers)
    const activePlayerNames = new Set(
      updatedPlayers.slice(0, event.maxPlayers).map(p => p.name)
    );

    const hasBenchPlayersInTeams = existingTeams.some(team =>
      team.members.some(member => !activePlayerNames.has(member.name))
    );

    if (hasBenchPlayersInTeams) {
      // Clear teams to force re-randomization
      await prisma.teamResult.deleteMany({ where: { eventId } });
      sseManager.broadcast(eventId, "update", { action: "player_order_reset" });
      return Response.json({
        ok: true,
        teamsCleared: true,
        message: "Player order reset. Teams have been cleared because bench players were in active teams. Please re-randomize."
      });
    }
  }

  sseManager.broadcast(eventId, "update", { action: "player_order_reset" });

  return Response.json({ ok: true, teamsCleared: false });
};
