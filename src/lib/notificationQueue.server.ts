import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import type { TranslationKey } from "./i18n";
import pLimit from "p-limit";

const log = createLogger("notification-queue");

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
/** Max concurrent job processing to avoid overwhelming the DB connection pool */
const JOB_CONCURRENCY = 10;
/** Dead-letter jobs older than this are pruned on each drain run */
const DEAD_LETTER_TTL_DAYS = 30;

export type NotificationJobType =
  | "player_joined"
  | "player_left"
  | "player_joined_bench"
  | "player_left_bench"
  | "player_left_promoted"
  | "event_details"
  | "reminder"
  | "post_game";

export interface NotificationJobPayload {
  title: string;
  key: TranslationKey;
  params: Record<string, string>;
  url: string;
  spotsLeft: number;
  /** Only set for "reminder" jobs — used to check per-timing push prefs */
  reminderType?: "24h" | "2h" | "1h";
}

/**
 * Enqueue a notification job.
 *
 * Returns a Promise so callers can await it when they need delivery guarantees
 * (e.g. tests). Fire-and-forget callers can ignore the return value — errors
 * are logged and never propagate to the caller.
 */
export function enqueueNotification(
  eventId: string,
  type: NotificationJobType,
  payload: NotificationJobPayload,
  senderClientId?: string,
): Promise<void> {
  return prisma.notificationJob
    .create({
      data: {
        eventId,
        type,
        payload: JSON.stringify(payload),
        senderClientId: senderClientId ?? null,
      },
    })
    .then(() => undefined)
    .catch((err: unknown) => {
      log.error({ eventId, type, err }, "Failed to enqueue notification job");
    });
}

/**
 * Singleton guard: if a drain is already in progress, new callers piggyback
 * on the running drain instead of starting a concurrent one. This avoids
 * SQLite BUSY errors and the race where concurrent drains both see 0 pending
 * jobs because the first one already claimed them.
 *
 * After the running drain finishes, we do one more pass to pick up any jobs
 * that were enqueued while the drain was in progress.
 */
let _drainInFlight: Promise<number> | null = null;
let _drainAgain = false;

export function drainNotificationQueue(): Promise<number> {
  if (_drainInFlight) {
    // A drain is already running — flag that we need another pass when it finishes
    _drainAgain = true;
    return _drainInFlight;
  }

  _drainInFlight = _doDrain()
    .then(async (count) => {
      // If new jobs were enqueued while we were draining, do one more pass
      if (_drainAgain) {
        _drainAgain = false;
        const extra = await _doDrain();
        return count + extra;
      }
      return count;
    })
    .finally(() => {
      _drainInFlight = null;
      _drainAgain = false;
    });

  return _drainInFlight;
}

/**
 * Internal drain implementation.
 *
 * Claims each batch atomically via a transaction (SQLite-safe).
 * NOTE(postgres #236): Replace the $transaction claim with
 * `SELECT ... FOR UPDATE SKIP LOCKED` when migrating to Postgres to get
 * true atomic claiming under READ COMMITTED isolation.
 *
 * Failed jobs are retried up to MAX_RETRIES times; after that they are
 * moved to dead-letter state (failedAt set). Dead-letter jobs older than
 * DEAD_LETTER_TTL_DAYS are pruned on each run.
 */
async function _doDrain(): Promise<number> {
  // Lazy import to avoid circular dependency
  const { sendPushToEvent } = await import("./push.server");

  // Prune stale dead-letter jobs first
  const cutoff = new Date(Date.now() - DEAD_LETTER_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.notificationJob
    .deleteMany({ where: { failedAt: { lt: cutoff } } })
    .catch((err: unknown) => log.error({ err }, "Failed to prune dead-letter jobs"));

  const limit = pLimit(JOB_CONCURRENCY);
  let totalProcessed = 0;

  while (true) {
    // Atomically claim a batch inside a transaction.
    // NOTE(postgres #236): swap this block for SELECT FOR UPDATE SKIP LOCKED.
    const jobs = await prisma.$transaction(async (tx) => {
      const pending = await tx.notificationJob.findMany({
        where: { processedAt: null, failedAt: null },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        select: { id: true },
      });
      if (pending.length === 0) return [];
      const ids = pending.map((j) => j.id);
      await tx.notificationJob.updateMany({
        where: { id: { in: ids } },
        data: { processedAt: new Date() },
      });
      return tx.notificationJob.findMany({ where: { id: { in: ids } } });
    });

    if (jobs.length === 0) break;

    await Promise.allSettled(
      jobs.map((job) =>
        limit(async () => {
          try {
            const payload = JSON.parse(job.payload) as NotificationJobPayload;
            await sendPushToEvent(
              job.eventId,
              payload.title,
              payload.key,
              payload.params,
              payload.url,
              payload.spotsLeft,
              job.senderClientId ?? undefined,
              job.type as NotificationJobType,
              payload.reminderType,
            );
          } catch (err: unknown) {
            log.error({ jobId: job.id, eventId: job.eventId, type: job.type, err }, "Failed to process notification job");
            const nextRetry = job.retryCount + 1;
            if (nextRetry >= MAX_RETRIES) {
              await prisma.notificationJob
                .update({ where: { id: job.id }, data: { failedAt: new Date(), processedAt: null } })
                .catch(() => {});
              log.error({ jobId: job.id }, "Notification job moved to dead-letter after max retries");
            } else {
              await prisma.notificationJob
                .update({ where: { id: job.id }, data: { processedAt: null, retryCount: nextRetry } })
                .catch(() => {});
            }
          }
        }),
      ),
    );

    totalProcessed += jobs.length;
    if (jobs.length < BATCH_SIZE) break;
  }

  return totalProcessed;
}
