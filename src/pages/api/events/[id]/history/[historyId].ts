import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { processGame, recalculateAllRatings } from "../../../../../lib/elo.server";
import { computeGameUpdates } from "../../../../../lib/elo";
import { checkOwnership, getSession } from "../../../../../lib/auth.helpers.server";
import { logEvent } from "../../../../../lib/eventLog.server";
import { createLogger } from "../../../../../lib/logger.server";

const log = createLogger("history-patch");

// PATCH /api/events/[id]/history/[historyId]
export const PATCH: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Require authentication for all history edits
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, params.id);

  const entry = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  if (!entry) return Response.json({ error: "Not found." }, { status: 404 });

  const body = await request.json();

  // Handle unlock request — owner/admin only, bypasses editableUntil check
  if (body.unlock === true) {
    if (!isOwner && !isAdmin) {
      return Response.json({ error: "Only the event owner or admin can unlock history." }, { status: 403 });
    }
    const newEditableUntil = new Date(Date.now() + 7 * 86400_000);
    const unlocked = await prisma.gameHistory.update({
      where: { id: params.historyId },
      data: { editableUntil: newEditableUntil },
    });

    const actor = session.user.name ?? session.user.email ?? "Unknown";
    const actorId = session.user.id;
    const historyDate = entry.dateTime.toISOString().slice(0, 10);
    logEvent(params.id!, "history_unlocked", actor, actorId, {
      historyId: entry.id, date: historyDate,
    });

    return Response.json({
      ...unlocked,
      dateTime: unlocked.dateTime.toISOString(),
      editableUntil: unlocked.editableUntil.toISOString(),
      createdAt: unlocked.createdAt.toISOString(),
      editable: unlocked.editableUntil > new Date(),
      eloUpdates: null,
    });
  }

  // Handle lock request — owner/admin only, sets editableUntil to the past
  if (body.lock === true) {
    if (!isOwner && !isAdmin) {
      return Response.json({ error: "Only the event owner or admin can lock history." }, { status: 403 });
    }
    const newEditableUntil = new Date(Date.now() - 1000);
    const locked = await prisma.gameHistory.update({
      where: { id: params.historyId },
      data: { editableUntil: newEditableUntil },
    });

    const actor = session.user.name ?? session.user.email ?? "Unknown";
    const actorId = session.user.id;
    const historyDate = entry.dateTime.toISOString().slice(0, 10);
    logEvent(params.id!, "history_locked", actor, actorId, {
      historyId: entry.id, date: historyDate,
    });

    return Response.json({
      ...locked,
      dateTime: locked.dateTime.toISOString(),
      editableUntil: locked.editableUntil.toISOString(),
      createdAt: locked.createdAt.toISOString(),
      editable: locked.editableUntil > new Date(),
      eloUpdates: null,
    });
  }

  if (entry.editableUntil <= new Date()) {
    return Response.json({ error: "This result can no longer be edited." }, { status: 403 });
  }

  // Allow owner, admin, or any player who participated in this game
  let isParticipant = false;

  // Check 1: match user's display name against the teamsSnapshot
  if (entry.teamsSnapshot && session.user.name) {
    try {
      const teams = JSON.parse(entry.teamsSnapshot) as Array<{ players: Array<{ name: string }> }>;
      const allNames = teams.flatMap((t) => t.players.map((p) => p.name.toLowerCase()));
      isParticipant = allNames.includes(session.user.name.toLowerCase());
    } catch { /* ignore parse errors */ }
  }

  // Check 2: match user's ID against claimed player spots in the event
  if (!isParticipant) {
    const claimedPlayer = await prisma.player.findFirst({
      where: { eventId: params.id, userId: session.user.id, archivedAt: null },
    });
    if (claimedPlayer) isParticipant = true;
  }

  if (event.ownerId && !isOwner && !isAdmin && !isParticipant) {
    return Response.json({ error: "Only the event owner or a participant can edit this." }, { status: 403 });
  }

  // Restrict team and payment edits to owner/admin only
  if (body.teamsSnapshot !== undefined || body.paymentsSnapshot !== undefined) {
    if (!isOwner && !isAdmin) {
      return Response.json({ error: "Only the event owner or admin can edit teams and payments." }, { status: 403 });
    }
  }

  const status = ["played", "cancelled"].includes(body.status) ? body.status : undefined;
  const scoreOne = body.scoreOne !== undefined ? (body.scoreOne === null ? null : parseInt(String(body.scoreOne), 10)) : undefined;
  const scoreTwo = body.scoreTwo !== undefined ? (body.scoreTwo === null ? null : parseInt(String(body.scoreTwo), 10)) : undefined;
  const teamsSnapshot = body.teamsSnapshot !== undefined ? JSON.stringify(body.teamsSnapshot) : undefined;
  const paymentsSnapshot = body.paymentsSnapshot !== undefined
    ? (body.paymentsSnapshot === null ? null : JSON.stringify(body.paymentsSnapshot))
    : undefined;

  const updated = await prisma.gameHistory.update({
    where: { id: params.historyId },
    data: {
      ...(status !== undefined && { status }),
      ...(scoreOne !== undefined && { scoreOne: isNaN(scoreOne as number) ? null : scoreOne }),
      ...(scoreTwo !== undefined && { scoreTwo: isNaN(scoreTwo as number) ? null : scoreTwo }),
      ...(teamsSnapshot !== undefined && { teamsSnapshot }),
      ...(paymentsSnapshot !== undefined && { paymentsSnapshot }),
    },
  });

  // Log activity for each type of change
  const actor = session.user.name ?? session.user.email ?? "Unknown";
  const actorId = session.user.id;
  const historyDate = entry.dateTime.toISOString().slice(0, 10);

  if (scoreOne !== undefined || scoreTwo !== undefined) {
    logEvent(params.id!, "history_score_updated", actor, actorId, {
      historyId: entry.id, date: historyDate,
      scoreOne: updated.scoreOne, scoreTwo: updated.scoreTwo,
    });
  }
  if (teamsSnapshot !== undefined) {
    logEvent(params.id!, "history_teams_updated", actor, actorId, {
      historyId: entry.id, date: historyDate,
    });

    // Auto-update live event payments to reflect the new player list
    const eventCost = await prisma.eventCost.findUnique({
      where: { eventId: params.id },
      include: { payments: true },
    });
    if (eventCost) {
      try {
        const newTeams = JSON.parse(updated.teamsSnapshot!) as Array<{ players: Array<{ name: string }> }>;
        const newPlayerNames = newTeams.flatMap((t) => t.players.map((p) => p.name));
        const share = newPlayerNames.length > 0 ? eventCost.totalAmount / newPlayerNames.length : 0;

        // Upsert payments for current players
        for (const name of newPlayerNames) {
          await prisma.playerPayment.upsert({
            where: { eventCostId_playerName: { eventCostId: eventCost.id, playerName: name } },
            create: { eventCostId: eventCost.id, playerName: name, amount: share },
            update: { amount: share },
          });
        }

        // Remove payments for players no longer in teams
        const activeNames = new Set(newPlayerNames);
        await prisma.playerPayment.deleteMany({
          where: {
            eventCostId: eventCost.id,
            playerName: { notIn: [...activeNames] },
          },
        });
      } catch (err) {
        log.error(`Failed to auto-sync payments after team update: eventId=${params.id} historyId=${params.historyId} error=${String(err)}`);
      }
    }
  }
  if (status !== undefined) {
    logEvent(params.id!, "history_status_updated", actor, actorId, {
      historyId: entry.id, date: historyDate, status: updated.status,
    });
  }
  if (paymentsSnapshot !== undefined) {
    logEvent(params.id!, "history_payments_updated", actor, actorId, {
      historyId: entry.id, date: historyDate,
    });
  }

  // Trigger ELO DB update when scores are saved for the first time
  const finalScoreOne = updated.scoreOne;
  const finalScoreTwo = updated.scoreTwo;
  if (
    updated.status === "played" &&
    finalScoreOne != null &&
    finalScoreTwo != null &&
    updated.teamsSnapshot &&
    !updated.eloProcessed
  ) {
    try {
      await processGame(params.id!, updated.id, JSON.parse(updated.teamsSnapshot), finalScoreOne, finalScoreTwo);
    } catch { /* ELO processing is best-effort */ }
  }

  // Recalculate all ratings when teams or scores change on an already-processed game
  if (
    updated.eloProcessed &&
    (teamsSnapshot !== undefined || scoreOne !== undefined || scoreTwo !== undefined)
  ) {
    try {
      await recalculateAllRatings(params.id!);
    } catch { /* recalculation is best-effort */ }
  }

  // Always compute ELO deltas for display (even if already processed)
  let eloUpdates = null;
  if (
    updated.status === "played" &&
    finalScoreOne != null &&
    finalScoreTwo != null &&
    updated.teamsSnapshot
  ) {
    try {
      const snapshot = JSON.parse(updated.teamsSnapshot);
      const ratings = await prisma.playerRating.findMany({ where: { eventId: params.id } });
      const playerInfos = ratings.map((r) => ({ name: r.name, rating: r.rating, gamesPlayed: r.gamesPlayed }));
      eloUpdates = computeGameUpdates(playerInfos, snapshot, finalScoreOne, finalScoreTwo)
        .map((u) => ({ name: u.name, delta: u.delta }));
    } catch { /* best-effort */ }
  }

  return Response.json({
    ...updated,
    dateTime: updated.dateTime.toISOString(),
    editableUntil: updated.editableUntil.toISOString(),
    createdAt: updated.createdAt.toISOString(),
    editable: updated.editableUntil > new Date(),
    eloUpdates,
  });
};

// DELETE /api/events/[id]/history/[historyId] — owner/admin only
export const DELETE: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, params.id);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner or admin can delete history entries." }, { status: 403 });
  }

  const entry = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  if (!entry) return Response.json({ error: "Not found." }, { status: 404 });

  // If ELO was already processed, recalculate ratings after deletion
  const needsRecalc = entry.eloProcessed;

  await prisma.gameHistory.delete({ where: { id: params.historyId } });

  if (needsRecalc) {
    await recalculateAllRatings(params.id!);
  }

  const actor = session.user.name ?? session.user.email ?? "Unknown";
  logEvent(params.id!, "history_status_updated", actor, session.user.id, {
    historyId: params.historyId,
    action: "deleted",
  });

  return new Response(null, { status: 204 });
};
