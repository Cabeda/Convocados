import { prisma } from "./db.server";

const WINDOWS: Record<string, { minMs: number; maxMs: number }> = {
  "24h": { minMs: 22 * 3600_000, maxMs: 26 * 3600_000 },
  "2h":  { minMs: 1 * 3600_000,  maxMs: 3 * 3600_000 },
  "1h":  { minMs: 30 * 60_000,   maxMs: 90 * 60_000 },
};

export interface UpcomingReminder {
  eventId: string;
  eventTitle: string;
  dateTime: Date;
  location: string;
  /** Active spots on the Event — the `maxPlayers` the Roster capacity is read against. */
  maxPlayers: number;
  players: { name: string; userId: string | null; email: string | null }[];
  currentGameId: string | null;
  reminder24h: boolean;
  reminder2h: boolean;
  reminder1h: boolean;
}

/** Find events that need a reminder of the given type and haven't been sent yet. */
export async function getUpcomingReminders(type: "24h" | "2h" | "1h"): Promise<UpcomingReminder[]> {
  const window = WINDOWS[type];
  const now = Date.now();
  const from = new Date(now + window.minMs);
  const to = new Date(now + window.maxMs);

  const events = await prisma.event.findMany({
    where: {
      archivedAt: null,
      dateTime: { gte: from, lte: to },
      reminderLogs: { none: { type } },
    },
    include: {
      players: { include: { user: { select: { email: true } } } },
    },
  });

  return events.map((e) => ({
    eventId: e.id,
    eventTitle: e.title,
    dateTime: e.dateTime,
    location: e.location,
    maxPlayers: e.maxPlayers,
    players: e.players.map((p) => ({
      name: p.name,
      userId: p.userId,
      email: p.user?.email ?? null,
    })),
    currentGameId: e.currentGameId,
    reminder24h: e.reminder24h,
    reminder2h: e.reminder2h,
    reminder1h: e.reminder1h,
  }));
}

/**
 * Find events where the game has ended (dateTime + durationMinutes is in the past)
 * and no "post-game" reminder has been sent yet.
 * Only considers games that ended within the last 4 hours to avoid spamming old events.
 */
export async function getPostGameReminders(): Promise<UpcomingReminder[]> {
  const now = Date.now();
  const fourHoursAgo = new Date(now - 4 * 3600_000);

  const events = await prisma.event.findMany({
    where: {
      archivedAt: null,
      // Game started at least durationMinutes ago — we can't filter by computed
      // end time in Prisma, so we fetch recent past events and filter in JS
      dateTime: { gte: fourHoursAgo, lte: new Date(now) },
      reminderLogs: { none: { type: "post-game" } },
    },
    include: {
      players: { include: { user: { select: { email: true } } } },
    },
  });

  // Filter to events where dateTime + durationMinutes <= now
  return events
    .filter((e) => {
      const endTime = new Date(e.dateTime.getTime() + e.durationMinutes * 60_000);
      return endTime.getTime() <= now;
    })
    .map((e) => ({
      eventId: e.id,
      eventTitle: e.title,
      dateTime: e.dateTime,
      location: e.location,
      maxPlayers: e.maxPlayers,
      players: e.players.map((p) => ({
        name: p.name,
        userId: p.userId,
        email: p.user?.email ?? null,
      })),
      currentGameId: e.currentGameId,
      reminder24h: e.reminder24h,
      reminder2h: e.reminder2h,
      reminder1h: e.reminder1h,
    }));
}

/** Mark a reminder as sent so it won't fire again. */
export async function markReminderSent(eventId: string, type: string) {
  await prisma.reminderLog.create({ data: { eventId, type } });
}

/**
 * Whether a pre-game reminder timing exists for this event at all (Reminder
 * Timings — the organizer's per-event selection). Gates every channel: a
 * disabled timing emits no push, email or webhook. User-level reminder prefs
 * AND with this for individual delivery; subscriptions see this gate only.
 */
export function isReminderEnabled(
  event: { reminder24h: boolean; reminder2h: boolean; reminder1h: boolean },
  type: "24h" | "2h" | "1h",
): boolean {
  return type === "24h" ? event.reminder24h : type === "2h" ? event.reminder2h : event.reminder1h;
}
