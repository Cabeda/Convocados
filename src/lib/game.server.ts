/** ADR 0016 — Game lifecycle helpers */

import { prisma } from "./db.server";
import { activeOrderedParticipantsWhere, activeParticipantsWhere } from "./activeParticipants.server";

/** Returns true if a Game is eligible for ELO processing (played + not friendly). */
export async function shouldProcessGameElo(gameId: string): Promise<boolean> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { status: true, isFriendly: true },
  });
  if (!game) return false;
  return game.status === "played" && !game.isFriendly;
}

/**
 * Next order slot for a GameParticipant appended to a game's queue.
 *
 * Single source of truth for GameParticipant order assignment (issue #657).
 * Game-scoped and gap-safe: uses max(order)+1 so it never collides with
 * archived participants that kept their old slot, and never drifts toward
 * the event-wide Player count (which grows across games).
 */
export async function nextGameParticipantOrder(gameId: string): Promise<number> {
  const agg = await prisma.gameParticipant.aggregate({
    where: activeParticipantsWhere(gameId),
    _max: { order: true },
  });
  return (agg._max.order ?? -1) + 1;
}

export interface GrantActiveSpotResult {
  /** True when the player holds an active spot (order < maxPlayers). */
  active: boolean;
  /** EventPlayer id that was displaced to the bench, if an eviction happened. */
  evictedEventPlayerId?: string;
}

/**
 * Guarantee an active spot for a priority-confirmed player (ADR 0020).
 *
 * Rules:
 * - Room available  → append at the end of the queue (order = max+1).
 * - Game full       → evict the last NON-priority active player to the bench
 *   (end of queue) and give their slot to the priority player. Priority
 *   players are never evicted by another priority player.
 * - No eviction target (all active are priority) → append at the end (bench).
 */
export async function grantActiveSpot(
  eventId: string,
  gameId: string,
  eventPlayerId: string,
  maxPlayers: number,
): Promise<GrantActiveSpotResult> {
  const existing = await prisma.gameParticipant.findUnique({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
  });
  if (existing && !existing.archivedAt && existing.status !== "pending" && existing.order < maxPlayers) {
    return { active: true };
  }

  const active = await prisma.gameParticipant.findMany({
    where: activeOrderedParticipantsWhere(gameId, maxPlayers),
    include: { eventPlayer: { select: { userId: true, name: true } } },
    orderBy: { order: "asc" },
  });

  if (active.length < maxPlayers) {
    const order = await nextGameParticipantOrder(gameId);
    await prisma.gameParticipant.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
      create: { gameId, eventPlayerId, order, status: "active" },
      update: { archivedAt: null, order, status: "active" },
    });
    return { active: true };
  }

  const priorityUserIds = new Set(
    (await prisma.priorityEnrollment.findMany({
      where: { eventId, optedIn: true },
      select: { userId: true },
    })).map((e) => e.userId),
  );

  const victim = [...active].reverse().find((p) => {
    if (!p.eventPlayer.userId) return true;
    return !priorityUserIds.has(p.eventPlayer.userId);
  });

  if (!victim) {
    const order = await nextGameParticipantOrder(gameId);
    await prisma.gameParticipant.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
      create: { gameId, eventPlayerId, order, status: "active" },
      update: { archivedAt: null, order, status: "active" },
    });
    return { active: false };
  }

  const benchOrder = await nextGameParticipantOrder(gameId);
  await prisma.$transaction([
    prisma.gameParticipant.update({
      where: { id: victim.id },
      data: { order: benchOrder },
    }),
    prisma.gameParticipant.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
      create: { gameId, eventPlayerId, order: victim.order, status: "active" },
      update: { archivedAt: null, order: victim.order, status: "active" },
    }),
  ]);
  return { active: true, evictedEventPlayerId: victim.eventPlayerId };
}
