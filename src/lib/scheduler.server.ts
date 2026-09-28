import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import { enqueueNotification, drainNotificationQueue } from "./notificationQueue.server";
import { sendReminder } from "./email.server";
import { getNotificationPrefs, wantsEmailReminder } from "./notificationPrefs.server";
import { findSplitIdentities, collapseSplitIdentities, reconcilePaymentNames } from "./backfillMergedIdentity.server";
import { recalculateAllRatings } from "./elo.server";

const log = createLogger("scheduler");

const APP_URL = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";

export const SCHEDULER_HEARTBEAT_ID = "scheduler";

/** Upsert the scheduler liveness heartbeat. Called on every due-jobs poll. */
export async function recordSchedulerHeartbeat(): Promise<void> {
  await prisma.schedulerHeartbeat.upsert({
    where: { id: SCHEDULER_HEARTBEAT_ID },
    create: { id: SCHEDULER_HEARTBEAT_ID, lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() },
  });
}

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
    where: { eventId, processedAt: null, runAt: { gt: new Date() } },
  });
}

/**
 * How long a claim is honored before the job becomes claimable again.
 * Must exceed the worker's fetch timeout (30s) so a live claim is never
 * stolen, while a crashed worker's job is redelivered within minutes.
 */
export const CLAIM_LEASE_MS = 2 * 60 * 1000;

/** Exponential backoff base: retry after 10s, then 20s, then dead at 3rd. */
const RETRY_BASE_MS = 10_000;
const MAX_ATTEMPTS = 3;

/** Default bound for due-job fetches; callers may pass a smaller take. */
export const DEFAULT_DUE_LIMIT = 50;

/** Jobs whose claim lapsed (dead worker) are claimable again. */
function claimableWhere(now: Date) {
  return {
    processedAt: null,
    failedAt: null,
    OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - CLAIM_LEASE_MS) } }],
  };
}

/**
 * Atomically claim a job before running side effects (guarded updateMany —
 * only one concurrent caller wins). Returns the claimed row, or null if the
 * job is already processed/failed or held under an active lease elsewhere.
 */
export async function claimJob(jobId: string) {
  const now = new Date();
  const token = `${process.pid}:${now.getTime()}:${Math.random().toString(36).slice(2, 10)}`;
  const won = await prisma.scheduledJob.updateMany({
    where: { id: jobId, ...claimableWhere(now) },
    data: { claimedAt: now, claimedBy: token },
  });
  if (won.count === 0) return null;
  return prisma.scheduledJob.findFirst({ where: { id: jobId, claimedBy: token } });
}

/** Dead-lettered jobs (retry exhausted) — surfaced via /api/health. */
export async function countFailedJobs(): Promise<number> {
  return prisma.scheduledJob.count({ where: { failedAt: { not: null } } });
}

/**
 * Get jobs that are due (runAt <= now), unprocessed, unfailed and not held
 * under an active claim — bounded by `limit` so one poll can't flood workers.
 */
export async function getDueJobs(limit = DEFAULT_DUE_LIMIT) {
  const now = new Date();
  return prisma.scheduledJob.findMany({
    where: {
      runAt: { lte: now },
      ...claimableWhere(now),
    },
    orderBy: { runAt: "asc" },
    take: limit,
  });
}

/**
 * Process a single scheduled job.
 * Claims the job first (one winner per job even under concurrency), then
 * runs the side effect. Failure releases the claim and pushes runAt forward
 * exponentially; the third failure dead-letters the job.
 * Returns "processed" or "skipped" (lost claim / already done / missing).
 */
export async function processJob(jobId: string): Promise<"processed" | "skipped"> {
  const job = await claimJob(jobId);
  if (!job) {
    const existing = await prisma.scheduledJob.findUnique({ where: { id: jobId } });
    if (!existing) {
      log.warn({ jobId }, "Scheduled job not found");
    } else if (!existing.processedAt && !existing.failedAt) {
      log.info({ jobId }, "Scheduled job claim lost — skipping duplicate delivery");
    }
    return "skipped";
  }

  try {
    if (job.type.startsWith("reminder_")) {
      await _processReminderJob(job);
    } else if (job.type === "post_game") {
      await _processPostGameJob(job);
    } else if (job.type === "backfill_merged_identity") {
      await _processBackfillMergedIdentityJob();
    } else {
      log.warn({ jobId, type: job.type }, "Unknown scheduled job type");
    }

    await prisma.scheduledJob.update({
      where: { id: jobId },
      data: { processedAt: new Date(), claimedAt: null, claimedBy: null },
    });
    return "processed";
  } catch (err) {
    log.error({ jobId, type: job.type, err }, "Failed to process scheduled job");
    const nextRetry = job.retryCount + 1;
    if (nextRetry >= MAX_ATTEMPTS) {
      await prisma.scheduledJob.update({
        where: { id: jobId },
        data: { failedAt: new Date(), processedAt: null, claimedAt: null, claimedBy: null },
      });
    } else {
      await prisma.scheduledJob.update({
        where: { id: jobId },
        data: {
          retryCount: nextRetry,
          runAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (nextRetry - 1)),
          claimedAt: null,
          claimedBy: null,
        },
      });
    }
    throw err;
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
  // Archived events never notify — jobs may still be queued from before the
  // archive. Mark processed (the caller does) without sending anything.
  if (event.archivedAt) return;

  const activePlayers = event.players.filter((p) => !p.archivedAt);
  const spotsLeft = Math.max(0, event.maxPlayers - activePlayers.length);

  // Enqueue push notification
  await enqueueNotification(event.id, "reminder", {
    title: event.title,
    key: reminderType === "24h" ? "notifyGameReminder24h" : reminderType === "2h" ? "notifyGameReminder2h" : "notifyGameReminder1h",
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

  // Mark reminder as sent (idempotent — handles retries / duplicates gracefully)
  const logType = JOB_TO_LOG_TYPE[job.type];
  if (logType) {
    await prisma.reminderLog.upsert({
      where: { eventId_type: { eventId: event.id, type: logType } },
      create: { eventId: event.id, type: logType },
      update: {},
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
  // Archived events never notify (see _processReminderJob).
  if (event.archivedAt) return;

  const activePlayers = event.players.filter((p) => !p.archivedAt);
  const spotsLeft = Math.max(0, event.maxPlayers - activePlayers.length);

  await enqueueNotification(event.id, "post_game", {
    title: event.title,
    key: event.isRecurring ? "postGameNotificationRecurring" : "postGameNotification",
    params: { title: event.title },
    url: `/events/${event.id}?action=add-score`,
    spotsLeft,
  });
  await drainNotificationQueue();

  await prisma.reminderLog.upsert({
    where: { eventId_type: { eventId: event.id, type: "post-game" } },
    create: { eventId: event.id, type: "post-game" },
    update: {},
  });
}

/**
 * One-shot backfill (enqueued by the `backfill_merged_player_identity`
 * migration): collapse player identities that cross-account merges left split
 * before `mergeUsers` learned to collapse name-keyed identity (ADR 0040), then
 * rebuild ELO for the affected events. Idempotent — a no-op once collapsed.
 */
async function _processBackfillMergedIdentityJob(): Promise<void> {
  const identities = await findSplitIdentities(prisma);
  const eventIds = new Set<string>();
  if (identities.length > 0) {
    await collapseSplitIdentities(prisma, identities);
    for (const i of identities) eventIds.add(i.eventId);
  }

  // Payment names are denormalized on GamePayment + the frozen paymentsSnapshot
  // JSON, so they can still be stale even when the identity is already
  // collapsed (an earlier run rewrote team snapshots only).
  const correctedPayments = await reconcilePaymentNames(prisma);

  let recalculated = 0;
  for (const eventId of eventIds) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { eloEnabled: true } });
    if (event?.eloEnabled) {
      await recalculateAllRatings(eventId);
      recalculated++;
    }
  }

  log.info(
    { groups: identities.length, events: eventIds.size, correctedPayments, recalculated },
    "backfill_merged_identity: done",
  );
}
