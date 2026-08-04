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

  // ADR 0016: merge game-scoped identity. A source EventPlayer row (with its
  // GameParticipant/Rsvp/GamePayment children) would otherwise linger as a ghost
  // on the live game list after the legacy Player row is deleted. Reassign
  // children to the target EventPlayer (or rename source → target when the
  // target has no EventPlayer yet).
  await mergeEventPlayer(eventId, sourceName, targetName, mergedUserId);

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

/**
 * Merge game-scoped identity (ADR 0016) when two player names are collapsed:
 * - If a target EventPlayer exists, reassign the source's GameParticipant,
 *   Rsvp and GamePayment children to it, then delete the source EventPlayer.
 * - If only the source EventPlayer exists, rename it to the target name and
 *   adopt the merged userId.
 *
 * Without this, the source name stays visible on the live game list even though
 * its legacy Player row was deleted (ghost participant).
 */
async function mergeEventPlayer(eventId: string, sourceName: string, targetName: string, mergedUserId: string | null): Promise<void> {
  const [sourceEp, targetEp] = await Promise.all([
    prisma.eventPlayer.findUnique({ where: { eventId_name: { eventId, name: sourceName } } }),
    prisma.eventPlayer.findUnique({ where: { eventId_name: { eventId, name: targetName } } }),
  ]);
  if (!sourceEp) return;

  if (!targetEp) {
    await prisma.eventPlayer.update({
      where: { id: sourceEp.id },
      data: { name: targetName, ...(mergedUserId ? { userId: mergedUserId } : {}) },
    });
    return;
  }

  // Reassign children from source → target. GameParticipant is unique on
  // (gameId, eventPlayerId), so when the target already participates in the
  // same game, drop the source's row instead of colliding.
  const [sourceParticipants, sourceRsvps, sourcePayments, targetParticipantGameIds, targetRsvpRows] = await Promise.all([
    prisma.gameParticipant.findMany({ where: { eventPlayerId: sourceEp.id }, select: { id: true, gameId: true } }),
    prisma.rsvp.findMany({ where: { eventPlayerId: sourceEp.id }, select: { id: true, gameId: true } }),
    prisma.gamePayment.findMany({ where: { eventPlayerId: sourceEp.id }, select: { id: true } }),
    prisma.gameParticipant.findMany({ where: { eventPlayerId: targetEp.id }, select: { gameId: true } }),
    prisma.rsvp.findMany({ where: { eventPlayerId: targetEp.id }, select: { gameId: true } }),
  ]);
  const targetGameIds = new Set(targetParticipantGameIds.map((g) => g.gameId));
  const targetRsvpGameIds = new Set(targetRsvpRows.map((r) => r.gameId));

  const participantMoves = sourceParticipants
    .filter((p) => !targetGameIds.has(p.gameId))
    .map((p) =>
      prisma.gameParticipant.update({
        where: { id: p.id },
        data: { eventPlayerId: targetEp.id },
      }),
    );
  const participantDrops = sourceParticipants
    .filter((p) => targetGameIds.has(p.gameId))
    .map((p) => prisma.gameParticipant.delete({ where: { id: p.id } }));

  // Move the source's RSVP answer to the target (re-key on the unique pair).
  // When the target already answered on the same game, prefer the target's row.
  const rsvpMoves = sourceRsvps
    .filter((r) => !targetRsvpGameIds.has(r.gameId))
    .map((r) => prisma.rsvp.update({ where: { id: r.id }, data: { eventPlayerId: targetEp.id } }));
  const rsvpDrops = sourceRsvps
    .filter((r) => targetRsvpGameIds.has(r.gameId))
    .map((r) => prisma.rsvp.delete({ where: { id: r.id } }));

  const paymentMoves = sourcePayments.map((p) =>
    prisma.gamePayment.update({ where: { id: p.id }, data: { eventPlayerId: targetEp.id } }),
  );

  await prisma.$transaction([
    ...participantMoves,
    ...participantDrops,
    ...rsvpMoves,
    ...rsvpDrops,
    ...paymentMoves,
    prisma.eventPlayer.update({
      where: { id: targetEp.id },
      data: { ...(mergedUserId ? { userId: mergedUserId } : {}) },
    }),
    prisma.eventPlayer.delete({ where: { id: sourceEp.id } }),
  ]);
}
