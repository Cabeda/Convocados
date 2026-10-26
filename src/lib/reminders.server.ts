import pLimit from "p-limit";
import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import { enqueueNotification } from "./notificationQueue.server";
import { sendReminder } from "./email.server";
import { getNotificationPrefs, wantsEmailReminder } from "./notificationPrefs.server";
import { getRosterCapacity } from "./roster.server";
import { fireWebhooks } from "./webhook.server";

const log = createLogger("reminders");

const APP_URL = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";

/** Max concurrent outbound reminder emails to avoid overwhelming the SMTP provider. */
const EMAIL_CONCURRENCY = 10;

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

/**
 * Record a reminder as sent so it won't fire again. Idempotent: a repeat send
 * for the same `(eventId, type)` updates the row instead of throwing on the
 * `@@unique([eventId, type])` key.
 */
export async function markReminderSent(eventId: string, type: string) {
  await prisma.reminderLog.upsert({
    where: { eventId_type: { eventId, type } },
    create: { eventId, type },
    update: {},
  });
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

export type GameReminderType = "24h" | "2h" | "1h";
export type ReminderType = GameReminderType | "post-game";

export type ReminderOutcome = "delivered" | "disabled" | "already-sent" | "archived";

const REMINDER_KEYS = {
  "24h": "notifyGameReminder24h",
  "2h": "notifyGameReminder2h",
  "1h": "notifyGameReminder1h",
} as const;

/**
 * The one reminder delivery — the cron window scan and the scheduled job both
 * call this, so push, email, webhook and the ReminderLog cannot drift apart.
 *
 * Remaining capacity is the Roster's answer (ADR 0016), read once and shared by
 * the push and the email. An archived Event, a disabled Reminder Timing or an
 * already-logged `(eventId, type)` delivers nothing and does not throw.
 *
 * The dedup is sequential, not a lease: two triggers that both read before
 * either marks can both deliver. At-least-once is deliberate — a claim would
 * trade the occasional duplicate for a silent miss, and the cron marks only
 * after the push queue drains.
 *
 * The caller records the send with `markReminderSent` — the cron does it after
 * the push queue is drained, the scheduler inline.
 */
export async function deliverReminder(eventId: string, type: ReminderType): Promise<ReminderOutcome> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { include: { user: { select: { email: true } } } } },
  });
  // Archived events never notify — a job may still be queued from before the
  // archive, and the window scans already exclude them.
  if (!event || event.archivedAt) return "archived";

  const alreadySent = await prisma.reminderLog.findUnique({
    where: { eventId_type: { eventId: event.id, type } },
    select: { id: true },
  });
  if (alreadySent) return "already-sent";

  // Reminder Timings gate: a disabled timing emits nothing on any channel.
  if (type !== "post-game" && !isReminderEnabled(event, type)) return "disabled";

  const { spotsLeft } = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);

  if (type === "post-game") {
    await enqueueNotification(event.id, "post_game", {
      title: event.title,
      key: event.isRecurring ? "postGameNotificationRecurring" : "postGameNotification",
      params: { title: event.title },
      url: `/events/${event.id}?action=add-score`,
      spotsLeft,
    });
    return "delivered";
  }

  await enqueueNotification(event.id, "reminder", {
    title: event.title,
    key: REMINDER_KEYS[type],
    params: { title: event.title },
    url: `/events/${event.id}?action=rsvp`,
    spotsLeft,
    reminderType: type,
  });

  // Fire reminder webhook (non-blocking) — lean domain facts, client renders
  fireWebhooks(event.id, "reminder", {
    reminderType: type,
    gameId: event.currentGameId,
    dateTime: event.dateTime.toISOString(),
  }).catch(() => {});

  // Each player's preferences are read through the one loader, which also
  // applies the auto-enable; merging a batch row back over it would undo that.
  const players = event.players.filter((p) => !p.archivedAt);

  const emailLimit = pLimit(EMAIL_CONCURRENCY);
  await Promise.allSettled(
    players.map((player) =>
      emailLimit(async () => {
        if (!player.userId || !player.user?.email) return;
        try {
          const prefs = await getNotificationPrefs(player.userId);
          if (!wantsEmailReminder(prefs, type)) return;
          await sendReminder(player.user.email, {
            eventTitle: event.title,
            dateTime: event.dateTime.toISOString(),
            location: event.location,
            spotsLeft,
            eventUrl: `${APP_URL}/events/${event.id}`,
            reminderType: type,
          });
        } catch (err) {
          log.error({ email: player.user.email, eventId: event.id, type, err }, "Failed to send email reminder");
        }
      }),
    ),
  );

  return "delivered";
}
