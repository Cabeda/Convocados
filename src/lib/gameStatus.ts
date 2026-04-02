/**
 * Game status helpers — determines whether a game has ended based on
 * its start time and configured duration.
 */

/**
 * Returns true if the game has ended: dateTime + durationMinutes <= now.
 * Accepts Date objects or ISO strings for dateTime.
 */
export function isGameEnded(
  dateTime: Date | string,
  durationMinutes: number,
  now: Date = new Date(),
): boolean {
  const start = typeof dateTime === "string" ? new Date(dateTime) : dateTime;
  const endTime = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return endTime <= now;
}
