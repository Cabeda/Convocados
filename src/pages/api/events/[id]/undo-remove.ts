import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { addPlayerToTeams, validateTeams } from "./players";

const UNDO_WINDOW_MS = 60_000; // 60 seconds

/** POST — undo a player removal by re-inserting them at their original position */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const { name, order, userId, removedAt } = await request.json();

  if (!name || typeof order !== "number" || !removedAt) {
    return Response.json({ error: "Invalid undo data." }, { status: 400 });
  }

  // Check time window
  if (Date.now() - removedAt > UNDO_WINDOW_MS) {
    return Response.json({ error: "Undo window expired." }, { status: 410 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Check the name isn't already taken (someone else re-added with the same name)
  const existing = event.players.find((p) => p.name === name);
  if (existing) {
    return Response.json({ error: `"${name}" is already in the list.` }, { status: 409 });
  }

  // Shift players at or after the original position to make room
  const toShift = event.players.filter((p) => p.order >= order);
  await prisma.$transaction([
    ...toShift.map((p) =>
      prisma.player.update({ where: { id: p.id }, data: { order: p.order + 1 } })
    ),
    prisma.player.create({
      data: {
        name,
        eventId,
        order,
        userId: userId ?? null,
      } as any,
    }),
  ]);

  // Re-sync teams if the restored player is in the active range
  if (order < event.maxPlayers) {
    await addPlayerToTeams(eventId, name);
  }

  // Validate teams: ensure no bench players are in teams after undo
  await validateTeams(eventId, event.maxPlayers);


  return Response.json({ ok: true });
};
