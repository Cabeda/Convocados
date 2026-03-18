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

/** Mark a reminder as sent so it won't fire again. */
export async function markReminderSent(eventId: string, type: string) {
  await prisma.reminderLog.create({ data: { eventId, type } });
}
