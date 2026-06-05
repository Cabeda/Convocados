import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { recalculateAllRatings } from "../../../../lib/elo.server";
import { logEvent } from "../../../../lib/eventLog.server";

/**
 * POST /api/events/:id/merge-player
 *
 * Merges two player identities within an event. The source player's history
 * is absorbed into the target player. Use when the same human played under
 * two different names (e.g., "Gonçalo" anonymous + "Gonçalo Silva" linked).
 *
 * Body: { sourceName: string, targetName: string }
 *
 * What happens:
 * 1. All GameHistory teamsSnapshot entries with sourceName are renamed to targetName
 * 2. MvpVote references are updated
 * 3. Source PlayerRating is deleted (recalculate rebuilds from history)
 * 4. Source Player record is deleted (if present)
 * 5. Target PlayerRating.userId is preserved (or inherited from source if target has none)
 * 6. ELO ratings are recalculated from scratch
 *
 * Admin/owner only.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin, session } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner or admin can merge players." }, { status: 403 });
  }

  const body = await request.json();
  const { sourceName, targetName } = body as { sourceName?: string; targetName?: string };

  if (!sourceName || !targetName || typeof sourceName !== "string" || typeof targetName !== "string") {
    return Response.json({ error: "sourceName and targetName are required." }, { status: 400 });
  }

  if (sourceName === targetName) {
    return Response.json({ error: "Source and target must be different." }, { status: 400 });
  }

  // Verify at least one of them exists in the event's history (PlayerRating or GameHistory)
  const sourceRating = await prisma.playerRating.findUnique({
    where: { eventId_name: { eventId, name: sourceName } },
  });
  const targetRating = await prisma.playerRating.findUnique({
    where: { eventId_name: { eventId, name: targetName } },
  });

  if (!sourceRating && !targetRating) {
    return Response.json({ error: "Neither player has a rating record in this event." }, { status: 404 });
  }

  // Determine the userId for the merged record: prefer target's, then source's
  const mergedUserId = targetRating?.userId ?? sourceRating?.userId ?? null;

  // 1. Rename sourceName → targetName in all GameHistory teamsSnapshot
  const histories = await prisma.gameHistory.findMany({
    where: { eventId },
    select: { id: true, teamsSnapshot: true },
  });

  const snapshotUpdates = histories.flatMap((h) => {
    if (!h.teamsSnapshot || !h.teamsSnapshot.includes(sourceName)) return [];
    try {
      const teams: { team: string; players: { name: string; order: number }[] }[] = JSON.parse(h.teamsSnapshot);
      let changed = false;
      for (const team of teams) {
        for (const p of team.players) {
          if (p.name === sourceName) {
            p.name = targetName;
            changed = true;
          }
        }
      }
      if (!changed) return [];
      return [prisma.gameHistory.update({ where: { id: h.id }, data: { teamsSnapshot: JSON.stringify(teams) } })];
    } catch { return []; }
  });

  // 2. Update MvpVote references
  const mvpUpdates = [
    prisma.mvpVote.updateMany({
      where: { voterName: sourceName, gameHistory: { eventId } },
      data: { voterName: targetName },
    }),
    prisma.mvpVote.updateMany({
      where: { votedForName: sourceName, gameHistory: { eventId } },
      data: { votedForName: targetName },
    }),
  ];

  // 3. Delete source PlayerRating + Player, update target userId
  await prisma.$transaction([
    ...snapshotUpdates,
    ...mvpUpdates,
    prisma.playerRating.deleteMany({ where: { eventId, name: sourceName } }),
    prisma.player.deleteMany({ where: { eventId, name: sourceName } }),
    prisma.teamMember.updateMany({ where: { name: sourceName, team: { eventId } }, data: { name: targetName } }),
    // Ensure target rating exists and has the merged userId
    ...(targetRating
      ? [prisma.playerRating.update({ where: { id: targetRating.id }, data: { userId: mergedUserId } })]
      : [prisma.playerRating.create({ data: { eventId, name: targetName, userId: mergedUserId } })]),
  ]);

  // 4. Recalculate ELO from scratch (history now has all games under targetName)
  if (event.eloEnabled) {
    await recalculateAllRatings(eventId);
  }
  // Ensure target rating exists with correct userId (recalculate may recreate without it)
  if (mergedUserId) {
    await prisma.playerRating.upsert({
      where: { eventId_name: { eventId, name: targetName } },
      create: { eventId, name: targetName, userId: mergedUserId },
      update: { userId: mergedUserId },
    });
  }

  await logEvent(eventId, "player_merged", session?.user?.name ?? null, session?.user?.id ?? null, {
    sourceName,
    targetName,
    mergedUserId,
  });

  return Response.json({ ok: true, mergedInto: targetName, userId: mergedUserId });
};
