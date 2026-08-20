import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../../lib/authenticate.server";
import {
  applyDeclinePenalty,
  computeCoPlayScore,
  SUGGESTIONS_CAP,
  type CoPlayRecord,
} from "../../../../lib/suggestions";

interface Suggestion {
  name: string;
  userId: string;
  image: string | null;
  gamesPlayed: number;
  coPlayCount: number;
  score: number;
  invitedPending: boolean;
}

/**
 * GET /api/events/[id]/suggestions
 *
 * Ranked invite candidates for the current user ("inviter") on the given
 * event, sourced from the inviter's own co-play history. Powers the future
 * "Suggested" chips UI. Auth required.
 *
 * Hard exclusions (candidate dropped entirely):
 *   - candidate NotificationPreferences.invitesEnabled === false
 *   - candidate's EventPlayer for THIS event has invitationOptOutAt set
 *   - pending PlayerInvite for (currentGame, candidate)
 *   - Rsvp status "no" on currentGame for the candidate
 *   - candidate already has an active GameParticipant on currentGame
 *   - PriorityEnrollment.noShowStreak >= 2 for (event, candidate)
 *
 * Soft penalty: >= 3 declined PlayerInvites on the event multiply the score
 * by 0.1 (candidate sinks to the bottom but is still listed).
 */
export const GET: APIRoute = async ({ params, request }) => {
  const authCtx = await authenticateRequest(request);
  const sessionUserId = authCtx?.userId ?? (await getSession(request))?.user?.id;
  if (!sessionUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventId = params.id;
  if (!eventId) {
    return Response.json({ error: "Missing event id" }, { status: 400 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { currentGameId: true },
  });
  if (!event?.currentGameId) {
    return Response.json({ suggestions: [] });
  }
  const currentGameId = event.currentGameId;

  const now = new Date();

  // 1. The inviter's EventPlayers across all events.
  const inviterEventPlayers = await prisma.eventPlayer.findMany({
    where: { userId: sessionUserId },
    select: { id: true },
  });
  const inviterEventPlayerIds = inviterEventPlayers.map((ep) => ep.id);
  if (inviterEventPlayerIds.length === 0) {
    return Response.json({ suggestions: [] });
  }

  // 2. Co-play history: games the inviter played, then the OTHER players in them.
  const inviterParticipations = await prisma.gameParticipant.findMany({
    where: {
      eventPlayerId: { in: inviterEventPlayerIds },
      status: "active",
      archivedAt: null,
    },
    select: { gameId: true },
  });
  const inviterGameIds = [...new Set(inviterParticipations.map((p) => p.gameId))];
  if (inviterGameIds.length === 0) {
    return Response.json({ suggestions: [] });
  }

  const coPlayRows = await prisma.gameParticipant.findMany({
    where: {
      gameId: { in: inviterGameIds },
      eventPlayerId: { notIn: inviterEventPlayerIds },
      status: "active",
      archivedAt: null,
    },
    include: {
      eventPlayer: { select: { userId: true, name: true, gamesPlayed: true } },
      game: { select: { dateTime: true } },
    },
  });

  // 3. Aggregate per candidate userId (guests have no userId and are not inviteable).
  const recordsByUser = new Map<string, CoPlayRecord[]>();
  for (const row of coPlayRows) {
    const candidateUserId = row.eventPlayer.userId;
    if (!candidateUserId || candidateUserId === sessionUserId) continue;
    const record: CoPlayRecord = {
      userId: candidateUserId,
      name: row.eventPlayer.name,
      gamesPlayed: row.eventPlayer.gamesPlayed,
      gameDateTime: row.game.dateTime,
    };
    const list = recordsByUser.get(candidateUserId) ?? [];
    list.push(record);
    recordsByUser.set(candidateUserId, list);
  }
  if (recordsByUser.size === 0) {
    return Response.json({ suggestions: [] });
  }

  const candidateUserIds = [...recordsByUser.keys()];

  // This event's EventPlayers for the candidates — needed for the exclusions
  // that are keyed on the candidate's per-event identity.
  const thisEventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId, userId: { in: candidateUserIds } },
    select: { id: true, userId: true, name: true, invitationOptOutAt: true, gamesPlayed: true },
  });
  const thisEventEpByUser = new Map<string, (typeof thisEventPlayers)[number]>();
  for (const ep of thisEventPlayers) {
    if (ep.userId) thisEventEpByUser.set(ep.userId, ep);
  }
  const thisEventEpIds = thisEventPlayers.map((ep) => ep.id);

  const [prefRows, declinedInvites, rsvpNoRows, activeParticipantRows, enrollments, pendingInvites] =
    await Promise.all([
      // global kill switch (missing row = default invitesEnabled true)
      prisma.notificationPreferences.findMany({
        where: { userId: { in: candidateUserIds } },
        select: { userId: true, invitesEnabled: true },
      }),
      // decline history on THIS event (any game), for the soft penalty
      prisma.playerInvite.findMany({
        where: { eventPlayerId: { in: thisEventEpIds }, status: "declined" },
        select: { eventPlayerId: true },
      }),
      // rsvp "no" on the current game
      prisma.rsvp.findMany({
        where: { gameId: currentGameId, eventPlayerId: { in: thisEventEpIds }, status: "no" },
        select: { eventPlayerId: true },
      }),
      // already joined the current game
      prisma.gameParticipant.findMany({
        where: {
          gameId: currentGameId,
          eventPlayerId: { in: thisEventEpIds },
          status: "active",
          archivedAt: null,
        },
        select: { eventPlayerId: true },
      }),
      // no-show history on this event
      prisma.priorityEnrollment.findMany({
        where: { eventId, userId: { in: candidateUserIds } },
        select: { userId: true, noShowStreak: true },
      }),
      // already pending-invited to the current game (invites are keyed on the
      // candidate's this-event EventPlayer, so candidates without one can't match)
      prisma.playerInvite.findMany({
        where: { gameId: currentGameId, eventPlayerId: { in: thisEventEpIds }, status: "pending" },
        select: { eventPlayerId: true },
      }),
    ]);

  const invitesEnabledByUser = new Map(prefRows.map((r) => [r.userId, r.invitesEnabled]));
  const noShowStreakByUser = new Map(enrollments.map((r) => [r.userId, r.noShowStreak]));
  const pendingInviteEpIds = new Set(pendingInvites.map((r) => r.eventPlayerId));
  const rsvpNoEpIds = new Set(rsvpNoRows.map((r) => r.eventPlayerId));
  const activeParticipantEpIds = new Set(activeParticipantRows.map((r) => r.eventPlayerId));

  const declinedCountByEp = new Map<string, number>();
  for (const invite of declinedInvites) {
    declinedCountByEp.set(invite.eventPlayerId, (declinedCountByEp.get(invite.eventPlayerId) ?? 0) + 1);
  }

  // Batch image lookup.
  const userRows = await prisma.user.findMany({
    where: { id: { in: candidateUserIds } },
    select: { id: true, name: true, image: true },
  });
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const suggestions: Suggestion[] = [];
  for (const [candidateUserId, records] of recordsByUser) {
    const thisEp = thisEventEpByUser.get(candidateUserId);

    // Hard exclusions.
    if (invitesEnabledByUser.get(candidateUserId) === false) continue;
    if (thisEp?.invitationOptOutAt) continue;
    if (thisEp && pendingInviteEpIds.has(thisEp.id)) continue;
    if (thisEp && rsvpNoEpIds.has(thisEp.id)) continue;
    if (thisEp && activeParticipantEpIds.has(thisEp.id)) continue;
    if ((noShowStreakByUser.get(candidateUserId) ?? 0) >= 2) continue;

    const user = userById.get(candidateUserId);
    const declinedCount = thisEp ? (declinedCountByEp.get(thisEp.id) ?? 0) : 0;
    const lastRecord = records[records.length - 1];

    suggestions.push({
      name: thisEp?.name ?? user?.name ?? lastRecord.name,
      userId: candidateUserId,
      image: user?.image ?? null,
      gamesPlayed: thisEp?.gamesPlayed ?? lastRecord.gamesPlayed,
      coPlayCount: records.length,
      score: applyDeclinePenalty(computeCoPlayScore(records, now), declinedCount),
      // Pending-invited candidates are excluded above, so this is always false today.
      invitedPending: false,
    });
  }

  suggestions.sort((a, b) => b.score - a.score);
  return Response.json({ suggestions: suggestions.slice(0, SUGGESTIONS_CAP) });
};