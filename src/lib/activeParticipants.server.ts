import type { Prisma } from "./db.server";

/**
 * Shared Prisma where for an active (non-archived, non-pending) GameParticipant.
 * Pending rows are invite ghosts (ADR 0025) — visible as "invited" but never part of
 * roster/bench math, payments, or team draws.
 *
 * Single source of truth for #803 — every path that answers "who is on the roster"
 * must go through this helper instead of re-deriving the same where locally.
 */
export function activeParticipantsWhere(gameId: string): Prisma.GameParticipantWhereInput {
  return { gameId, archivedAt: null, status: { not: "pending" } };
}

/** Where for the ordered active slice (order < maxPlayers) — used by grantActiveSpot. */
export function activeOrderedParticipantsWhere(
  gameId: string,
  maxPlayers: number,
): Prisma.GameParticipantWhereInput {
  return { gameId, archivedAt: null, status: { not: "pending" }, order: { lt: maxPlayers } };
}
