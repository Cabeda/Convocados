/**
 * Game status helpers — the one place that answers which phase a Game is in.
 */

export type GamePhase = "upcoming" | "in_progress" | "played" | "cancelled";

/**
 * The phase a Game is in, derived from kickoff + the Event's duration. The
 * stored status is only authoritative for the two terminal states the write
 * path owns: cancelled (never derive over it) and played (already snapshotted).
 * Everything else follows the clock, so a stale "upcoming" row becomes live at
 * kickoff and played at kickoff + duration, exactly as the Wear list already
 * derives it.
 */
export function gamePhase(
  game: { dateTime: Date | string; status?: string | null },
  durationMinutes: number,
  now: Date = new Date(),
): GamePhase {
  if (game.status === "cancelled") return "cancelled";
  if (game.status === "played") return "played";
  const start = typeof game.dateTime === "string" ? new Date(game.dateTime) : game.dateTime;
  if (Number.isNaN(start.getTime())) return "upcoming";
  if (now < start) return "upcoming";
  const endTime = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return now < endTime ? "in_progress" : "played";
}

/**
 * Returns true if the game has ended: dateTime + durationMinutes <= now.
 * Accepts Date objects or ISO strings for dateTime.
 */
export function isGameEnded(
  dateTime: Date | string,
  durationMinutes: number,
  now: Date = new Date(),
): boolean {
  return gamePhase({ dateTime }, durationMinutes, now) === "played";
}
