import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import { drainNotificationQueue } from "./notificationQueue.server";
import { deliverReminder, markReminderSent, type GameReminderType } from "./reminders.server";
import { findSplitIdentities, collapseSplitIdentities, reconcilePaymentNames } from "./backfillMergedIdentity.server";
import { recalculateAllRatings } from "./elo.server";

const log = createLogger("scheduler");

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

/** Cap stored failure text so a pathological error can't bloat the row. */
const MAX_LAST_ERROR_CHARS = 1000;

/** Render a thrown value for storage on the job row. */
function describeJobError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > MAX_LAST_ERROR_CHARS
    ? `${message.slice(0, MAX_LAST_ERROR_CHARS)}…`
    : message;
}

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

/**
 * How far back the health counter looks.
 *
 * A dead-letter is a record of an escalated failure: it stays in the table so
 * `/api/health` can still show its diagnosis, but once the cause is fixed it
 * must stop reading as "something is broken now". Before this window the count
 * only ever grew — it sat at 7 for months after the backfills behind them were
 * remediated, which trained everyone to ignore the number (#1347). A failure
 * that keeps recurring keeps counting, every day it recurs.
 */
export const FAILED_JOB_WINDOW_HOURS = 24;

/** Dead-lettered jobs inside the window — surfaced via /api/health. */
export async function countFailedJobs(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - FAILED_JOB_WINDOW_HOURS * 3_600_000);
  return prisma.scheduledJob.count({ where: { failedAt: { gte: since } } });
}

/**
 * Jobs that have recorded a failure reason, newest first — retrying jobs
 * (`lastError` set, `failedAt` null) as well as dead-lettered ones. The count
 * alone tells a human "something broke"; this tells them what and where, so
 * diagnosis does not need production DB access or logs that no longer exist.
 * `deadLettered` distinguishes the two: a retrying job may still recover.
 */
export async function getRecentJobFailures(limit = 50) {
  const rows = await prisma.scheduledJob.findMany({
    where: { lastError: { not: null } },
    // Dead-letters first (non-null failedAt), then retrying jobs (null sorts
    // last under DESC); runAt breaks ties deterministically.
    orderBy: [{ failedAt: "desc" }, { runAt: "desc" }],
    take: limit,
    select: {
      id: true,
      type: true,
      eventId: true,
      runAt: true,
      retryCount: true,
      failedAt: true,
      lastError: true,
    },
  });
  return rows.map((r) => ({ ...r, deadLettered: r.failedAt !== null }));
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
      data: { processedAt: new Date(), claimedAt: null, claimedBy: null, lastError: null },
    });
    return "processed";
  } catch (err) {
    log.error({ jobId, type: job.type, err }, "Failed to process scheduled job");
    const nextRetry = job.retryCount + 1;
    const lastError = describeJobError(err);
    if (nextRetry >= MAX_ATTEMPTS) {
      await prisma.scheduledJob.update({
        where: { id: jobId },
        data: { failedAt: new Date(), processedAt: null, claimedAt: null, claimedBy: null, lastError },
      });
    } else {
      await prisma.scheduledJob.update({
        where: { id: jobId },
        data: {
          retryCount: nextRetry,
          runAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (nextRetry - 1)),
          claimedAt: null,
          claimedBy: null,
          lastError,
        },
      });
    }
    throw err;
  }
}

async function _processReminderJob(job: { id: string; eventId: string | null; type: string }) {
  if (!job.eventId) return;

  const reminderType = job.type.replace("reminder_", "") as GameReminderType;
  const outcome = await deliverReminder(job.eventId, reminderType);
  if (outcome === "already-sent" || outcome === "archived") return;
  if (outcome === "delivered-with-failures") {
    log.warn({ eventId: job.eventId, type: reminderType }, "Reminder delivered with email failures");
  }
  // A disabled timing is still recorded as sent ("intentionally skipped") so
  // the job is closed out and nothing re-sweeps the window. The same holds
  // after a partial email failure: the push already went out, and retrying
  // would duplicate it.
  if (outcome === "delivered" || outcome === "delivered-with-failures") {
    await drainNotificationQueue();
  }
  await markReminderSent(job.eventId, reminderType);
}

async function _processPostGameJob(job: { id: string; eventId: string | null }) {
  if (!job.eventId) return;

  const outcome = await deliverReminder(job.eventId, "post-game");
  if (outcome === "already-sent" || outcome === "archived") return;
  await drainNotificationQueue();
  await markReminderSent(job.eventId, "post-game");
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
