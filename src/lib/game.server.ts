/** ADR 0016 — Game lifecycle helpers */

import { prisma } from "./db.server";

/** Returns true if a Game is eligible for ELO processing (played + not friendly). */
export async function shouldProcessGameElo(gameId: string): Promise<boolean> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { status: true, isFriendly: true },
  });
  if (!game) return false;
  return game.status === "played" && !game.isFriendly;
}
