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

  // Fetch all game histories that need snapshot scrubbing
  const histories = await prisma.gameHistory.findMany({
    where: { eventId },
    select: { id: true, teamsSnapshot: true, paymentsSnapshot: true },
  });

  // Build atomic transaction: delete records + scrub all JSON blobs
  await prisma.$transaction([
    // 1. Delete Player record (if still on roster)
    prisma.player.deleteMany({ where: { eventId, name } }),

    // 2. Delete PlayerRating record
    prisma.playerRating.deleteMany({ where: { eventId, name } }),

    // 3. Delete PlayerPayment records keyed by playerName
    prisma.playerPayment.deleteMany({
      where: { eventCost: { eventId }, playerName: name },
    }),

    // 4. Scrub from TeamMember (live team assignments)
    prisma.teamMember.deleteMany({
      where: { name, team: { eventId } },
    }),

    // 5. Scrub teamsSnapshot and paymentsSnapshot JSON blobs
    ...histories.flatMap((h) => {
      const updates: Parameters<typeof prisma.gameHistory.update>[0]["data"] = {};

      if (h.teamsSnapshot) {
        const snapshot: { team: string; players: { name: string; order: number }[] }[] =
          JSON.parse(h.teamsSnapshot);
        updates.teamsSnapshot = JSON.stringify(
          snapshot.map((team) => ({
            ...team,
            players: team.players
              .filter((p) => p.name !== name)
              .map((p, i) => ({ ...p, order: i })),
          }))
        );
      }

      if (h.paymentsSnapshot) {
        const payments: { playerName: string; amount: number; status: string; method: string | null }[] =
          JSON.parse(h.paymentsSnapshot);
        updates.paymentsSnapshot = JSON.stringify(
          payments.filter((p) => p.playerName !== name)
        );
      }

      if (Object.keys(updates).length === 0) return [];
      return [prisma.gameHistory.update({ where: { id: h.id }, data: updates })];
    }),
  ]);

  // 6. Recalculate ELO only if enabled for this event
  if (event.eloEnabled) {
    await recalculateAllRatings(eventId);
  }

  await logEvent(eventId, "player_removed", session?.user?.name ?? null, session?.user?.id ?? null, {
    playerName: name,
    purged: true,
  });

  return Response.json({ ok: true });
};
