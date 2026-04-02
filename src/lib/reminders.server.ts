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
  players: { name: string; userId: string | null; email: string | null }[];
}

/** Find events that need a reminder of the given type and haven't been sent yet. */
export async function getUpcomingReminders(type: "24h" | "2h" | "1h"): Promise<UpcomingReminder[]> {
  const window = WINDOWS[type];
  const now = Date.now();
  const from = new Date(now + window.minMs);
  const to = new Date(now + window.maxMs);

  const events = await prisma.event.findMany({
    where: {
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
    players: e.players.map((p) => ({
      name: p.name,
      userId: p.userId,
      email: p.user?.email ?? null,
    })),
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
      players: e.players.map((p) => ({
        name: p.name,
        userId: p.userId,
        email: p.user?.email ?? null,
      })),
    }));
}

/** Mark a reminder as sent so it won't fire again. */
export async function markReminderSent(eventId: string, type: string) {
  await prisma.reminderLog.create({ data: { eventId, type } });
}
