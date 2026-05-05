import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import { enqueueNotification, drainNotificationQueue } from "./notificationQueue.server";
import { sendReminder } from "./email.server";
import { getNotificationPrefs, wantsEmailReminder } from "./notificationPrefs.server";

const log = createLogger("scheduler");

const APP_URL = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.fly.dev";

/** Reminder offsets in milliseconds */
const REMINDER_OFFSETS = {
  reminder_24h: 24 * 60 * 60 * 1000,
  reminder_2h: 2 * 60 * 60 * 1000,
  reminder_1h: 60 * 60 * 1000,
} as const;

/** Map ScheduledJob type to ReminderLog type */
const JOB_TO_LOG_TYPE: Record<string, string> = {
  reminder_24h: "24h",
  reminder_2h: "2h",
  reminder_1h: "1h",
  post_game: "post-game",
};

/**
 * Schedule reminder jobs for an event.
 * Creates 24h, 2h, 1h pre-game reminders and a post-game reminder.
 */
export async function scheduleEventReminders(
  eventId: string,
  dateTime: Date,
  durationMinutes: number
) {
  const jobs = [
    { type: "reminder_24h", runAt: new Date(dateTime.getTime() - REMINDER_OFFSETS.reminder_24h) },
    { type: "reminder_2h", runAt: new Date(dateTime.getTime() - REMINDER_OFFSETS.reminder_2h) },
    { type: "reminder_1h", runAt: new Date(dateTime.getTime() - REMINDER_OFFSETS.reminder_1h) },
  ];

  if (durationMinutes > 0) {
    jobs.push({
      type: "post_game",
      runAt: new Date(dateTime.getTime() + durationMinutes * 60 * 1000),
    });
  }

  await prisma.scheduledJob.createMany({
    data: jobs.map((j) => ({
      eventId,
      type: j.type,
      runAt: j.runAt,
      payload: "{}",
    })),
  });
}

/**
 * Cancel all pending (unprocessed) jobs for an event.
 * Does not touch already-processed jobs so history is preserved.
 */
export async function cancelEventJobs(eventId: string) {
  await prisma.scheduledJob.deleteMany({
    where: { eventId, processedAt: null },
  });
}

/**
 * Get all jobs that are due (runAt <= now) and not yet processed or failed.
 */
export async function getDueJobs() {
  return prisma.scheduledJob.findMany({
    where: {
      runAt: { lte: new Date() },
      processedAt: null,
      failedAt: null,
    },
    orderBy: { runAt: "asc" },
  });
}

/**
 * Process a single scheduled job.
 * Handles reminder and post-game jobs.
 */
export async function processJob(jobId: string): Promise<void> {
  const job = await prisma.scheduledJob.findUnique({ where: { id: jobId } });
  if (!job) {
    log.warn({ jobId }, "Scheduled job not found");
    return;
  }
  if (job.processedAt || job.failedAt) {
    return;
  }

  try {
    if (job.type.startsWith("reminder_")) {
      await _processReminderJob(job);
    } else if (job.type === "post_game") {
      await _processPostGameJob(job);
    } else {
      log.warn({ jobId, type: job.type }, "Unknown scheduled job type");
    }

    await prisma.scheduledJob.update({
      where: { id: jobId },
      data: { processedAt: new Date() },
    });
  } catch (err) {
    log.error({ jobId, type: job.type, err }, "Failed to process scheduled job");
    const nextRetry = job.retryCount + 1;
    if (nextRetry >= 3) {
      await prisma.scheduledJob.update({
        where: { id: jobId },
        data: { failedAt: new Date(), processedAt: null },
      });
      throw err;
    } else {
      await prisma.scheduledJob.update({
        where: { id: jobId },
        data: { retryCount: nextRetry },
      });
      throw err;
    }
  }
}

async function _processReminderJob(job: { id: string; eventId: string | null; type: string }) {
  if (!job.eventId) return;

  const reminderType = job.type.replace("reminder_", "") as "24h" | "2h" | "1h";
  const event = await prisma.event.findUnique({
    where: { id: job.eventId },
    include: {
      players: { include: { user: { select: { email: true } } } },
    },
  });
  if (!event) return;

  const activePlayers = event.players.filter((p) => !p.archivedAt);
  const spotsLeft = Math.max(0, event.maxPlayers - activePlayers.length);

  // Enqueue push notification
  await enqueueNotification(event.id, "reminder", {
    title: event.title,
    key: "notifyGameReminder",
    params: { title: event.title },
    url: `/events/${event.id}`,
    spotsLeft,
    reminderType,
  });
  await drainNotificationQueue();

  // Send emails to players who want them
  const userIds = activePlayers.map((p) => p.userId).filter(Boolean) as string[];
  if (userIds.length > 0) {
    const prefsRows = await prisma.notificationPreferences.findMany({
      where: { userId: { in: userIds } },
    });
    const prefsMap = new Map(prefsRows.map((p) => [p.userId, p]));

    for (const player of activePlayers) {
      if (!player.userId || !player.user?.email) continue;
      const raw = prefsMap.get(player.userId);
      const prefs = await getNotificationPrefs(player.userId);
      const effective = raw ? { ...prefs, ...raw } : prefs;
      if (!wantsEmailReminder(effective, reminderType)) continue;

      try {
        await sendReminder(player.user.email, {
          eventTitle: event.title,
          dateTime: event.dateTime.toISOString(),
          location: event.location,
          spotsLeft,
          eventUrl: `${APP_URL}/events/${event.id}`,
          reminderType,
        });
      } catch (err) {
        log.error({ email: player.user.email, eventId: event.id, err }, "Failed to send reminder email");
      }
    }
  }

  // Mark reminder as sent
  const logType = JOB_TO_LOG_TYPE[job.type];
  if (logType) {
    await prisma.reminderLog.create({
      data: { eventId: event.id, type: logType },
    });
  }
}

async function _processPostGameJob(job: { id: string; eventId: string | null }) {
  if (!job.eventId) return;

  const event = await prisma.event.findUnique({
    where: { id: job.eventId },
    include: {
      players: { include: { user: { select: { email: true } } } },
    },
  });
  if (!event) return;

  const activePlayers = event.players.filter((p) => !p.archivedAt);
  const spotsLeft = Math.max(0, event.maxPlayers - activePlayers.length);

  await enqueueNotification(event.id, "post_game", {
    title: event.title,
    key: "postGameNotification",
    params: { title: event.title },
    url: `/events/${event.id}`,
    spotsLeft,
  });
  await drainNotificationQueue();

  await prisma.reminderLog.create({
    data: { eventId: event.id, type: "post-game" },
  });
}
