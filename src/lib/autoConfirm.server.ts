/**
 * ADR 0018 — Auto-confirm attendance for recurring events.
 *
 * Players who attended the last N consecutive games (N = autoConfirmThreshold)
 * are auto-confirmed for the next occurrence. They don't receive the T-48h RSVP ping.
 *
 * ponytail: streak is computed from GameHistory/GameParticipant. If the event doesn't
 * use occurrence-based recurrence (ADR 0016), falls back to checking Player presence
 * in consecutive GameHistory entries. Upgrade path: dedicated attendance streak counter
 * on EventPlayer if this query becomes too expensive for large histories.
 */
import { prisma } from "./db.server";
import { createLogger } from "./logger.server";

const log = createLogger("auto-confirm");

/**
 * Get userIds that qualify for auto-confirm on this event.
 * Returns empty set if autoConfirmEnabled is false.
 */
export async function getAutoConfirmedUserIds(eventId: string): Promise<Set<string>> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { autoConfirmEnabled: true, autoConfirmThreshold: true, isRecurring: true },
  });

  if (!event?.autoConfirmEnabled || !event.isRecurring) return new Set();

  const threshold = event.autoConfirmThreshold;

  // Check games (occurrence-based — ADR 0016) first
  const games = await prisma.game.findMany({
    where: { eventId, status: "played" },
    orderBy: { dateTime: "desc" },
    take: threshold,
    select: {
      id: true,
      participants: {
        where: { archivedAt: null, noShow: false },
        select: { eventPlayer: { select: { userId: true } } },
      },
    },
  });

  if (games.length >= threshold) {
    // Occurrence-based: find userIds present in ALL of the last N games
    const userSets = games.map((g) =>
      new Set(g.participants.map((p) => p.eventPlayer.userId).filter(Boolean) as string[])
    );
    const first = userSets[0];
    const autoConfirmed = new Set<string>();
    for (const userId of first) {
      if (userSets.every((s) => s.has(userId))) {
        autoConfirmed.add(userId);
      }
    }
    return autoConfirmed;
  }

  // Fallback: check GameHistory for legacy events without Game records
  const recentGames = await prisma.gameHistory.findMany({
    where: { eventId, status: "played" },
    orderBy: { dateTime: "desc" },
    take: threshold,
    select: { id: true },
  });

  if (recentGames.length < threshold) return new Set();

  // ponytail: Legacy path — would need to parse teamsSnapshot JSON. Not implemented.
  // Upgrade path: migrate all events to occurrence-based (ADR 0016) then remove this.
  return new Set();
}

/**
 * Auto-create RSVP "yes" records for auto-confirmed players.
 * Called when a new game occurrence is created (at reset time).
 */
export async function applyAutoConfirm(eventId: string): Promise<string[]> {
  const autoConfirmed = await getAutoConfirmedUserIds(eventId);
  if (autoConfirmed.size === 0) return [];

  const applied: string[] = [];
  for (const userId of autoConfirmed) {
    try {
      // Create or update RSVP as "yes" (auto-confirmed)
      await prisma.rsvp.upsert({
        where: { userId_eventId: { userId, eventId } },
        create: { eventId, userId, status: "yes" },
        update: { status: "yes" },
      });
      applied.push(userId);
    } catch (err) {
      log.error({ eventId, userId, err }, "Failed to apply auto-confirm");
    }
  }

  return applied;
}
