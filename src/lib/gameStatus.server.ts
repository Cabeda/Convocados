import { prisma } from "./db.server";
import { gamePhase, type GamePhase } from "./gameStatus";

/** Lifecycle order; a phase only ever moves forward. */
const PHASE_RANK: Record<GamePhase, number> = {
  upcoming: 0,
  in_progress: 1,
  played: 2,
  cancelled: 3,
};

/**
 * Lazily persist the derived phase on the current Game through a CAS on its
 * stored status. Only forward transitions are written, so a concurrent advance
 * (which owns the same status column) cannot be undone by a slower reader.
 * Returns the phase to display, derived even when the write loses the race.
 */
export async function syncGamePhase(
  game: { id: string; dateTime: Date | string; status?: string | null },
  durationMinutes: number,
  now: Date = new Date(),
): Promise<GamePhase> {
  const phase = gamePhase(game, durationMinutes, now);
  const current = (game.status ?? "upcoming") as GamePhase;

  if (phase !== current && PHASE_RANK[phase] > (PHASE_RANK[current] ?? 0)) {
    await prisma.game.updateMany({
      where: { id: game.id, status: current },
      data: { status: phase },
    });
  }
  return phase;
}
