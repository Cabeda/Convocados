import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { processGame, recalculateAllRatings } from "../../../../../lib/elo.server";
import { computeGameUpdates } from "../../../../../lib/elo";
import { MVP_ELO_BONUS } from "../../../../../lib/mvp.constants";
import { checkOwnership, getSession } from "../../../../../lib/auth.helpers.server";
import { logEvent } from "../../../../../lib/eventLog.server";
import { createLogger } from "../../../../../lib/logger.server";

const log = createLogger("history-patch");

/**
 * Build a GameHistory row from a "played" live Game. The live Game model does
 * not store team assignments, so we reconstruct them from the event-level
 * teamResults (the canonical source for the current occurrence) and the
 * payments from the current EventCost. Used when the history PATCH is hit with
 * a Game id that has no GameHistory snapshot yet (ADR 0016).
 */
async function buildSnapshotForGame(eventId: string, game: { id: string; dateTime: Date; status: string; scoreOne: number | null; scoreTwo: number | null; teamOneName: string | null; teamTwoName: string | null; isFriendly: boolean }) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      teamResults: { include: { members: { orderBy: { order: "asc" } } } },
      eventCost: { include: { payments: true } },
    },
  });

  const teamsSnapshot = event?.teamResults.length
    ? JSON.stringify(
        event.teamResults.map((tr) => ({
          team: tr.name,
          players: tr.members.map((m) => ({ name: m.name, order: m.order })),
        })),
      )
    : null;

  const paymentsSnapshot = event?.eventCost?.payments.length
    ? JSON.stringify(
        event.eventCost.payments.map((p) => ({
          playerName: p.playerName,
          amount: p.amount,
          status: p.status,
          method: p.method,
        })),
      )
    : null;

  return {
    eventId,
    dateTime: game.dateTime,
    status: "played" as const,
    scoreOne: game.scoreOne,
    scoreTwo: game.scoreTwo,
    teamOneName: game.teamOneName ?? event?.teamOneName ?? "Team 1",
    teamTwoName: game.teamTwoName ?? event?.teamTwoName ?? "Team 2",
    teamsSnapshot,
    paymentsSnapshot,
    editableUntil: new Date(game.dateTime.getTime() + 7 * 86400_000),
    isFriendly: game.isFriendly,
    source: "live" as const,
    eloProcessed: false,
  };
}

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

  let entry = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });

  // ADR 0016: a "played" live Game may not yet have a GameHistory snapshot
  // (e.g. the game just ended but the recurrence reset hasn't run, or the
  // history entry was loaded directly). Materialise one so the score/teams
  // can be edited through the same path.
  let historyId = params.historyId;
  if (!entry) {
    const game = await prisma.game.findUnique({
      where: { id: params.historyId, eventId: params.id },
    });
    if (game && game.status === "played") {
      const snap = await buildSnapshotForGame(params.id ?? "", game);
      entry = await prisma.gameHistory.create({ data: snap });
      historyId = entry.id;
    }
  }
  if (!entry) return Response.json({ error: "Not found." }, { status: 404 });

  const body = await request.json();

  // Handle unlock request — owner/admin only, bypasses editableUntil check
  if (body.unlock === true) {
    if (!isOwner && !isAdmin) {
      return Response.json({ error: "Only the event owner or admin can unlock history." }, { status: 403 });
    }
    const newEditableUntil = new Date(Date.now() + 7 * 86400_000);
    const unlocked = await prisma.gameHistory.update({
      where: { id: historyId },
      data: { editableUntil: newEditableUntil },
    });

    const actor = session.user.name ?? session.user.email ?? "Unknown";
    const actorId = session.user.id;
    const historyDate = entry.dateTime.toISOString().slice(0, 10);
    logEvent((params.id ?? ""), "history_unlocked", actor, actorId, {
      historyId: entry.id, date: historyDate,
    });

    return Response.json({
      ...unlocked,
      id: params.historyId, // ponytail: use original requested id so client can match state (materialized entries get a new cuid)
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
      where: { id: historyId },
      data: { editableUntil: newEditableUntil },
    });

    const actor = session.user.name ?? session.user.email ?? "Unknown";
    const actorId = session.user.id;
    const historyDate = entry.dateTime.toISOString().slice(0, 10);
    logEvent((params.id ?? ""), "history_locked", actor, actorId, {
      historyId: entry.id, date: historyDate,
    });

    return Response.json({
      ...locked,
      id: params.historyId, // ponytail: use original requested id so client can match state
      dateTime: locked.dateTime.toISOString(),
      editableUntil: locked.editableUntil.toISOString(),
      createdAt: locked.createdAt.toISOString(),
      editable: locked.editableUntil > new Date(),
      eloUpdates: null,
    });
  }

  // Handle isFriendly toggle — owner/admin only
  if (typeof body.isFriendly === "boolean") {
    if (!isOwner && !isAdmin) {
      return Response.json({ error: "Only the event owner or admin can toggle friendly." }, { status: 403 });
    }
    const updated = await prisma.gameHistory.update({
      where: { id: historyId },
      data: { isFriendly: body.isFriendly },
    });

    // If toggling off friendly on a processed game, or on for an unprocessed one, recalculate ELO
    if (entry.eloProcessed && body.isFriendly) {
      // Was competitive + processed → now friendly: recalculate to exclude this game
      await recalculateAllRatings(params.id!);
    } else if (!body.isFriendly && !entry.eloProcessed && entry.scoreOne !== null && entry.scoreTwo !== null && entry.teamsSnapshot) {
      // Was friendly → now competitive with score: process ELO
      const teams = JSON.parse(entry.teamsSnapshot);
      await processGame(params.id!, entry.id, teams, entry.scoreOne, entry.scoreTwo);
    }

    return Response.json({
      ...updated,
      id: params.historyId, // ponytail: use original requested id so client can match state
      dateTime: updated.dateTime.toISOString(),
      editableUntil: updated.editableUntil.toISOString(),
      createdAt: updated.createdAt.toISOString(),
      editable: updated.editableUntil > new Date(),
      isFriendly: updated.isFriendly,
      eloUpdates: null,
    });
  }

  // Owners/admins bypass the 7-day editableUntil window. Regular users
  // (incl. participants) lose edit access after the window.
  if (entry.editableUntil <= new Date() && !isOwner && !isAdmin) {
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

  // Restrict team edits to owner/admin/participant; payment edits to owner/admin only
  if (body.paymentsSnapshot !== undefined) {
    if (!isOwner && !isAdmin) {
      return Response.json({ error: "Only the event owner or admin can edit payments." }, { status: 403 });
    }
  }
  if (body.teamsSnapshot !== undefined) {
    if (!isOwner && !isAdmin && !isParticipant) {
      return Response.json({ error: "Only the event owner, admin, or a participant can edit teams." }, { status: 403 });
    }
  }

  // ADR 0019: Handle per-game cost edit on a past game
  if (body.costTotalAmount !== undefined) {
    if (!isOwner && !isAdmin) {
      return Response.json({ error: "Only the event owner or admin can edit game cost." }, { status: 403 });
    }

    const newTotal = Number(body.costTotalAmount);
    if (!newTotal || newTotal <= 0) {
      return Response.json({ error: "costTotalAmount must be a positive number." }, { status: 400 });
    }
    const costCurrency = String(body.costCurrency ?? "EUR").trim().slice(0, 10) || "EUR";

    // Try to find the corresponding Game for this history entry
    const game = await prisma.game.findUnique({ where: { id: params.historyId } });

    // Determine old share amount from existing payments
    const eventCost = await prisma.eventCost.findUnique({
      where: { eventId: params.id },
      include: { payments: true },
    });

    // Get player list from the teamsSnapshot
    let playerNames: string[] = [];
    if (entry.teamsSnapshot) {
      try {
        const teams = JSON.parse(entry.teamsSnapshot) as Array<{ players: Array<{ name: string }> }>;
        playerNames = teams.flatMap((t) => t.players.map((p) => p.name));
      } catch { /* skip */ }
    }

    const newShare = playerNames.length > 0 ? newTotal / playerNames.length : 0;
    const newShareCents = Math.round(newShare * 100);

    // Update Game.costTotalAmount if this is a Game-backed entry
    if (game) {
      await prisma.game.update({
        where: { id: game.id },
        data: { costTotalAmount: newTotal, costCurrency },
      });

      // ADR 0019: Write cost_adjustment correction rows for post-migration games
      // Check if ledger rows exist for this game
      const existingDebits = await prisma.walletTransaction.findMany({
        where: { eventId: params.id, eventInstanceId: game.id, reason: "per_game_share", direction: "debit" },
        select: { userId: true, amountCents: true },
      });

      if (existingDebits.length > 0) {
        // Post-migration game — write cost_adjustment rows for the delta
        for (const debit of existingDebits) {
          const delta = newShareCents - debit.amountCents;
          if (delta === 0) continue;
          await prisma.walletTransaction.create({
            data: {
              eventId: params.id!,
              userId: debit.userId,
              amountCents: Math.abs(delta),
              currency: costCurrency,
              direction: delta > 0 ? "debit" : "credit",
              gameUnits: 0,
              reason: "cost_adjustment",
              eventInstanceId: game.id,
              markedById: session.user.id,
            },
          });
        }
      }

      // Also update GamePayment rows if they exist
      const gamePayments = await prisma.gamePayment.findMany({
        where: { gameId: game.id },
      });
      for (const gp of gamePayments) {
        await prisma.gamePayment.update({
          where: { id: gp.id },
          data: { amount: newShare },
        });
      }
    }

    // Update PlayerPayment rows (legacy/dual-write compat)
    if (eventCost && playerNames.length > 0) {
      for (const name of playerNames) {
        await prisma.playerPayment.upsert({
          where: { eventCostId_playerName: { eventCostId: eventCost.id, playerName: name } },
          create: { eventCostId: eventCost.id, playerName: name, amount: newShare },
          update: { amount: newShare },
        });
      }
    }

    // Update the paymentsSnapshot in GameHistory to reflect new amounts
    if (entry.paymentsSnapshot) {
      try {
        const payments = JSON.parse(entry.paymentsSnapshot) as Array<{ playerName: string; amount: number; status: string; method?: string }>;
        const updatedPayments = payments.map((p) => ({ ...p, amount: newShare }));
        await prisma.gameHistory.update({
          where: { id: historyId },
          data: { paymentsSnapshot: JSON.stringify(updatedPayments) },
        });
      } catch { /* skip malformed */ }
    }

    logEvent(params.id ?? "", "history_cost_updated", session.user.name ?? session.user.email ?? "Unknown", session.user.id, {
      historyId: entry.id, date: entry.dateTime.toISOString().slice(0, 10), newTotal, newShare,
    });

    const refreshed = await prisma.gameHistory.findUnique({ where: { id: historyId } });
    return Response.json({
      ...refreshed,
      id: params.historyId,
      dateTime: refreshed!.dateTime.toISOString(),
      editableUntil: refreshed!.editableUntil.toISOString(),
      createdAt: refreshed!.createdAt.toISOString(),
      editable: refreshed!.editableUntil > new Date(),
      costUpdated: true,
      eloUpdates: null,
    });
  }

  const status = ["played", "cancelled"].includes(body.status) ? body.status : undefined;
  const scoreOne = body.scoreOne !== undefined ? (body.scoreOne === null ? null : parseInt(String(body.scoreOne), 10)) : undefined;
  const scoreTwo = body.scoreTwo !== undefined ? (body.scoreTwo === null ? null : parseInt(String(body.scoreTwo), 10)) : undefined;
  const teamsSnapshot = body.teamsSnapshot !== undefined ? JSON.stringify(body.teamsSnapshot) : undefined;
  const paymentsSnapshot = body.paymentsSnapshot !== undefined
    ? (body.paymentsSnapshot === null ? null : JSON.stringify(body.paymentsSnapshot))
    : undefined;

  const updated = await prisma.gameHistory.update({
    where: { id: historyId },
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
    logEvent((params.id ?? ""), "history_score_updated", actor, actorId, {
      historyId: entry.id, date: historyDate,
      scoreOne: updated.scoreOne, scoreTwo: updated.scoreTwo,
    });
  }
  if (teamsSnapshot !== undefined) {
    logEvent((params.id ?? ""), "history_teams_updated", actor, actorId, {
      historyId: entry.id, date: historyDate,
    });

    // Auto-update live event payments to reflect the new player list
    const eventCost = await prisma.eventCost.findUnique({
      where: { eventId: params.id },
      include: { payments: true },
    });
    if (eventCost) {
      try {
        const newTeams = JSON.parse(updated.teamsSnapshot ?? "[]") as Array<{ players: Array<{ name: string }> }>;
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
        log.error(`Failed to auto-sync payments after team update: eventId=${params.id} historyId=${historyId} error=${String(err)}`);
      }
    }
  }
  if (status !== undefined) {
    logEvent((params.id ?? ""), "history_status_updated", actor, actorId, {
      historyId: entry.id, date: historyDate, status: updated.status,
    });
  }
  if (paymentsSnapshot !== undefined) {
    logEvent((params.id ?? ""), "history_payments_updated", actor, actorId, {
      historyId: entry.id, date: historyDate,
    });
  }

  // Trigger ELO DB update when scores are saved for the first time
  const finalScoreOne = updated.scoreOne;
  const finalScoreTwo = updated.scoreTwo;
  if (
    updated.status === "played" &&
    finalScoreOne !== null &&
    finalScoreTwo !== null &&
    updated.teamsSnapshot &&
    !updated.eloProcessed
  ) {
    try {
      await processGame((params.id ?? ""), updated.id, JSON.parse(updated.teamsSnapshot), finalScoreOne, finalScoreTwo);
    } catch { /* ELO processing is best-effort */ }
  }

  // Recalculate all ratings when teams or scores change on an already-processed game
  if (
    updated.eloProcessed &&
    (teamsSnapshot !== undefined || scoreOne !== undefined || scoreTwo !== undefined)
  ) {
    try {
      await recalculateAllRatings((params.id ?? ""));
    } catch { /* recalculation is best-effort */ }
  }

  // Always compute ELO deltas for display (even if already processed)
  let eloUpdates = null;
  if (
    updated.status === "played" &&
    finalScoreOne !== null &&
    finalScoreTwo !== null &&
    updated.teamsSnapshot
  ) {
    try {
      const snapshot = JSON.parse(updated.teamsSnapshot);
      const ratings = await prisma.playerRating.findMany({ where: { eventId: params.id } });
      const playerInfos = ratings.map((r) => ({ name: r.name, rating: r.rating, gamesPlayed: r.gamesPlayed }));
      eloUpdates = computeGameUpdates(playerInfos, snapshot, finalScoreOne, finalScoreTwo)
        .map((u) => ({ name: u.name, delta: u.delta }));

      // Add MVP ELO bonus to displayed deltas
      if (event.mvpEloEnabled) {
        const votes = await prisma.mvpVote.findMany({
          where: { gameHistoryId: historyId },
          select: { votedForName: true },
        });
        if (votes.length > 0) {
          const tally = new Map<string, number>();
          for (const v of votes) {
            tally.set(v.votedForName, (tally.get(v.votedForName) ?? 0) + 1);
          }
          const maxVotes = Math.max(...tally.values());
          const mvpNames = new Set(
            Array.from(tally.entries())
              .filter(([, count]) => count === maxVotes)
              .map(([name]) => name),
          );
          for (const u of eloUpdates) {
            if (mvpNames.has(u.name)) {
              u.delta += MVP_ELO_BONUS;
            }
          }
        }
      }
    } catch { /* best-effort */ }
  }

  return Response.json({
    ...updated,
    id: params.historyId, // ponytail: use original requested id so client can match state
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

  let entry = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  let deleteHistoryId = params.historyId;

  // ADR 0016: a "played" live Game may not yet have a GameHistory snapshot.
  // Materialise one, then delete it. The source Game keeps its "played" status
  // so it can be re-derived on demand — marking it "cancelled" would be wrong
  // (cancelled means a skipped game) and would leak into the post-game banner
  // and ELO skip filters.
  if (!entry) {
    const game = await prisma.game.findUnique({
      where: { id: params.historyId, eventId: params.id },
    });
    if (game && game.status === "played") {
      const snap = await buildSnapshotForGame(params.id ?? "", game);
      entry = await prisma.gameHistory.create({ data: snap });
      deleteHistoryId = entry.id;
    }
  }
  if (!entry) return Response.json({ error: "Not found." }, { status: 404 });

  // If ELO was already processed, recalculate ratings after deletion
  const needsRecalc = entry.eloProcessed;

  await prisma.gameHistory.delete({ where: { id: deleteHistoryId } });

  if (needsRecalc) {
    await recalculateAllRatings((params.id ?? ""));
  }

  const actor = session.user.name ?? session.user.email ?? "Unknown";
  logEvent((params.id ?? ""), "history_status_updated", actor, session.user.id, {
    historyId: deleteHistoryId,
    action: "deleted",
  });

  return new Response(null, { status: 204 });
};
