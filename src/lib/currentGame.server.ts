import { prisma } from "./db.server";

/**
 * A Game's status is the source of truth for cancellation. Event.currentGameId
 * is a scalar (no Prisma relation), so read it explicitly rather than joining.
 */
export async function isCurrentGameCancelled(currentGameId: string | null): Promise<boolean> {
  if (!currentGameId) return false;
  const game = await prisma.game.findUnique({
    where: { id: currentGameId },
    select: { status: true },
  });
  return game?.status === "cancelled";
}

/**
 * Drop events whose current Game is cancelled. Events with no current Game are
 * kept: a brand-new recurring Event may have none yet.
 */
export async function filterCancelledCurrentGames<T extends { currentGameId: string | null }>(
  rows: T[],
): Promise<T[]> {
  const ids = [...new Set(rows.map((row) => row.currentGameId).filter((id): id is string => !!id))];
  if (ids.length === 0) return rows;

  const cancelled = await prisma.game.findMany({
    where: { id: { in: ids }, status: "cancelled" },
    select: { id: true },
  });
  const cancelledIds = new Set(cancelled.map((game) => game.id));
  return rows.filter((row) => !row.currentGameId || !cancelledIds.has(row.currentGameId));
}
