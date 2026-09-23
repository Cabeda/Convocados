import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Collapse one player name into another *within a single event* (ADR 0016:
 * player identity is keyed by `(eventId, name)`, not by user).
 *
 * Rewrites historical `GameHistory.teamsSnapshot` JSON, the denormalized
 * `MvpVote` / `TeamMember` names, reassigns game-scoped children
 * (`GameParticipant`, `Rsvp`, `GamePayment`, payer), then deletes the source
 * `PlayerRating` / `Player` / `EventPlayer` rows.
 *
 * Does NOT recalculate ELO — callers decide whether to (the merge-player route
 * and the cross-account merge recalc after committing; tests skip it).
 */
export async function mergePlayerIdentity(
  tx: Tx,
  eventId: string,
  sourceName: string,
  targetName: string,
  mergedUserId: string | null,
): Promise<void> {
  if (!sourceName || !targetName || sourceName === targetName) return;

  const [histories, sourceEp, targetEp] = await Promise.all([
    tx.gameHistory.findMany({
      where: { eventId, teamsSnapshot: { contains: sourceName } },
      select: { id: true, teamsSnapshot: true },
    }),
    tx.eventPlayer.findUnique({ where: { eventId_name: { eventId, name: sourceName } } }),
    tx.eventPlayer.findUnique({ where: { eventId_name: { eventId, name: targetName } } }),
  ]);

  // 1. Rewrite teamsSnapshot history.
  for (const h of histories) {
    if (!h.teamsSnapshot) continue;
    try {
      const teams = JSON.parse(h.teamsSnapshot) as {
        team: string;
        players: { name: string; order: number }[];
      }[];
      let changed = false;
      for (const team of teams) {
        for (const p of team.players) {
          if (p.name === sourceName) {
            p.name = targetName;
            changed = true;
          }
        }
      }
      if (changed) {
        await tx.gameHistory.update({ where: { id: h.id }, data: { teamsSnapshot: JSON.stringify(teams) } });
      }
    } catch {
      // Malformed snapshot — leave it untouched rather than corrupt it.
    }
  }

  // 2. Denormalized names.
  await tx.mvpVote.updateMany({
    where: { voterName: sourceName, gameHistory: { eventId } },
    data: { voterName: targetName },
  });
  await tx.mvpVote.updateMany({
    where: { votedForName: sourceName, gameHistory: { eventId } },
    data: { votedForName: targetName },
  });
  await tx.teamMember.updateMany({
    where: { name: sourceName, team: { eventId } },
    data: { name: targetName },
  });

  // 2b. Denormalized payment names (GamePayment rows + the frozen
  // paymentsSnapshot JSON) — mirrors what purge-player scrubs.
  await tx.gamePayment.updateMany({
    where: { playerName: sourceName, game: { eventId } },
    data: { playerName: targetName },
  });
  const payHistories = await tx.gameHistory.findMany({
    where: { eventId, paymentsSnapshot: { contains: sourceName } },
    select: { id: true, paymentsSnapshot: true },
  });
  for (const h of payHistories) {
    if (!h.paymentsSnapshot) continue;
    try {
      const entries = JSON.parse(h.paymentsSnapshot) as { playerName: string }[];
      let changed = false;
      for (const e of entries) {
        if (e.playerName === sourceName) {
          e.playerName = targetName;
          changed = true;
        }
      }
      if (changed) {
        await tx.gameHistory.update({ where: { id: h.id }, data: { paymentsSnapshot: JSON.stringify(entries) } });
      }
    } catch {
      // Malformed snapshot — leave it untouched.
    }
  }

  // 3. Drop source legacy rows; ensure the target rating carries the user id.
  await tx.playerRating.deleteMany({ where: { eventId, name: sourceName } });
  await tx.player.deleteMany({ where: { eventId, name: sourceName } });
  await tx.playerRating.upsert({
    where: { eventId_name: { eventId, name: targetName } },
    create: { eventId, name: targetName, userId: mergedUserId },
    update: mergedUserId ? { userId: mergedUserId } : {},
  });

  // 4. Game-scoped identity (EventPlayer and its children).
  if (sourceEp && !targetEp) {
    await tx.eventPlayer.update({
      where: { id: sourceEp.id },
      data: { name: targetName, ...(mergedUserId ? { userId: mergedUserId } : {}) },
    });
  } else if (sourceEp && targetEp) {
    await reassignEventPlayerChildren(tx, sourceEp.id, targetEp.id, mergedUserId);
    await tx.eventPlayer.delete({ where: { id: sourceEp.id } });
  }
}

/**
 * Move a source EventPlayer's children onto the target, dropping rows that
 * would violate a unique constraint on the target (same game already covered).
 */
async function reassignEventPlayerChildren(
  tx: Tx,
  sourceId: string,
  targetId: string,
  mergedUserId: string | null,
): Promise<void> {
  const [sourceParticipants, sourceRsvps, sourcePayments, targetParticipantGameIds, targetRsvpRows] =
    await Promise.all([
      tx.gameParticipant.findMany({ where: { eventPlayerId: sourceId }, select: { id: true, gameId: true } }),
      tx.rsvp.findMany({ where: { eventPlayerId: sourceId }, select: { id: true, gameId: true } }),
      tx.gamePayment.findMany({ where: { eventPlayerId: sourceId }, select: { id: true } }),
      tx.gameParticipant.findMany({ where: { eventPlayerId: targetId }, select: { gameId: true } }),
      tx.rsvp.findMany({ where: { eventPlayerId: targetId }, select: { gameId: true } }),
    ]);

  const targetGameIds = new Set(targetParticipantGameIds.map((g) => g.gameId));
  const targetRsvpGameIds = new Set(targetRsvpRows.map((r) => r.gameId));

  for (const p of sourceParticipants) {
    if (targetGameIds.has(p.gameId)) {
      await tx.gameParticipant.delete({ where: { id: p.id } });
    } else {
      await tx.gameParticipant.update({ where: { id: p.id }, data: { eventPlayerId: targetId } });
    }
  }
  for (const r of sourceRsvps) {
    if (targetRsvpGameIds.has(r.gameId)) {
      await tx.rsvp.delete({ where: { id: r.id } });
    } else {
      await tx.rsvp.update({ where: { id: r.id }, data: { eventPlayerId: targetId } });
    }
  }
  for (const p of sourcePayments) {
    await tx.gamePayment.update({ where: { id: p.id }, data: { eventPlayerId: targetId } });
  }
  await tx.game.updateMany({
    where: { payerEventPlayerId: sourceId },
    data: { payerEventPlayerId: targetId },
  });
  if (mergedUserId) {
    await tx.eventPlayer.update({ where: { id: targetId }, data: { userId: mergedUserId } });
  }
}
