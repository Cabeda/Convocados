import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { recalculateAllRatings } from "../../../../lib/elo.server";
import { logEvent } from "../../../../lib/eventLog.server";

export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin, session } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner or admin can do this." }, { status: 403 });
  }

  const body = await request.json();
  const { name } = body as { name?: string };
  if (!name || typeof name !== "string") {
    return Response.json({ error: "name is required." }, { status: 400 });
  }

  // 1. Delete Player record (if still on roster)
  await prisma.player.deleteMany({ where: { eventId, name } });

  // 2. Delete PlayerRating record
  await prisma.playerRating.deleteMany({ where: { eventId, name } });

  // 3. Scrub player name from all teamsSnapshot JSON blobs
  const histories = await prisma.gameHistory.findMany({
    where: { eventId, teamsSnapshot: { not: null } },
    select: { id: true, teamsSnapshot: true },
  });

  for (const h of histories) {
    if (!h.teamsSnapshot) continue;
    const snapshot: { team: string; players: { name: string; order: number }[] }[] =
      JSON.parse(h.teamsSnapshot);
    const updated = snapshot.map((team) => ({
      ...team,
      players: team.players
        .filter((p) => p.name !== name)
        .map((p, i) => ({ ...p, order: i })),
    }));
    await prisma.gameHistory.update({
      where: { id: h.id },
      data: { teamsSnapshot: JSON.stringify(updated) },
    });
  }

  // 4. Recalculate ELO so ratings reflect the removal
  await recalculateAllRatings(eventId);

  await logEvent(eventId, "player_removed", session?.user?.name ?? null, session?.user?.id ?? null, {
    playerName: name,
    purged: true,
  });

  return Response.json({ ok: true });
};
