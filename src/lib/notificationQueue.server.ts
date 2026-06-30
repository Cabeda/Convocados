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
  | "post_game"
  | "game_full"
  | "spot_available"
  | "rsvp_request"
  | "game_cancelled"
  | "game_invite"
  | "bench_promoted_capacity"
  | "payment_confirmed"
  | "payment_self_reported"
  | "recruitment"
  | "few_spots_left";

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

const PLAYER_ACTIVITY_TYPES = new Set<string>([
  "player_joined", "player_left", "player_joined_bench", "player_left_bench", "player_left_promoted",
]);

/**
 * Group player-activity jobs for the same event within the grouping window.
 * Returns grouped jobs (collapsed) + non-activity jobs (passthrough).
 */
function groupPlayerActivityJobs(jobs: Array<{ id: string; eventId: string; type: string; payload: string; senderClientId: string | null; createdAt: Date; retryCount: number }>) {
  const activityByEvent = new Map<string, typeof jobs>();
  const other: typeof jobs = [];

  for (const job of jobs) {
    if (PLAYER_ACTIVITY_TYPES.has(job.type)) {
      const group = activityByEvent.get(job.eventId) ?? [];
      group.push(job);
      activityByEvent.set(job.eventId, group);
    } else {
      other.push(job);
    }
  }

  const grouped: Array<{ jobs: typeof jobs; eventId: string; payload: NotificationJobPayload; senderClientId: string | null; type: NotificationJobType }> = [];

  for (const [eventId, eventJobs] of activityByEvent) {
    if (eventJobs.length === 1) {
      // Single job — process normally
      other.push(eventJobs[0]);
      continue;
    }

    // Multiple player activity for same event — collapse
    const names: string[] = [];
    let latestPayload: NotificationJobPayload | null = null;
    for (const j of eventJobs) {
      const p = JSON.parse(j.payload) as NotificationJobPayload;
      latestPayload = p;
      if (p.params.name) names.push(p.params.name);
      else if (p.params.left) names.push(p.params.left);
    }

    const joinedCount = eventJobs.filter((j) => j.type.includes("joined")).length;
    const leftCount = eventJobs.filter((j) => j.type.includes("left")).length;

    let key: TranslationKey = "notifyPlayerActivityGrouped";
    const params: Record<string, string> = { count: String(names.length), names: names.slice(0, 3).join(", ") };
    if (joinedCount > 0 && leftCount === 0) {
      key = "notifyPlayersJoined";
      params.count = String(joinedCount);
    } else if (leftCount > 0 && joinedCount === 0) {
      key = "notifyPlayersLeft";
      params.count = String(leftCount);
    }

    grouped.push({
      jobs: eventJobs,
      eventId,
      payload: { ...(latestPayload as NotificationJobPayload), key, params },
      senderClientId: eventJobs[0].senderClientId,
      type: "player_joined" as NotificationJobType, // uses playerActivity prefs
    });
  }

  return { grouped, individual: other };
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

    const { grouped, individual } = groupPlayerActivityJobs(jobs);

    // Process grouped notifications (collapsed player activity)
    await Promise.allSettled(
      grouped.map((group) =>
        limit(async () => {
          try {
            await sendPushToEvent(
              group.eventId,
              group.payload.title,
              group.payload.key,
              group.payload.params,
              group.payload.url,
              group.payload.spotsLeft,
              group.senderClientId ?? undefined,
              group.type,
            );
            await createInAppNotifications(group.eventId, group.type, group.payload, group.senderClientId);
          } catch (err: unknown) {
            log.error({ eventId: group.eventId, err }, "Failed to process grouped notification");
          }
        }),
      ),
    );

    // Process individual (non-grouped) notifications
    await Promise.allSettled(
      individual.map((job) =>
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
            await createInAppNotifications(job.eventId, job.type as NotificationJobType, payload, job.senderClientId);
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

/**
 * Create in-app notification records for all followers of an event.
 * These persist so users can see missed notifications in their feed.
 */
async function createInAppNotifications(
  eventId: string,
  type: NotificationJobType,
  payload: NotificationJobPayload,
  senderClientId: string | null,
) {
  try {
    const follows = await prisma.eventFollow.findMany({
      where: { eventId },
      select: { userId: true },
    });
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { ownerId: true },
    });

    const recipientIds = new Set(follows.map((f) => f.userId));
    if (event?.ownerId) recipientIds.add(event.ownerId);
    if (senderClientId) recipientIds.delete(senderClientId);

    if (recipientIds.size === 0) return;

    await prisma.inAppNotification.createMany({
      data: [...recipientIds].map((userId) => ({
        userId,
        eventId,
        type,
        title: payload.title,
        body: `${payload.key}:${JSON.stringify(payload.params)}`,
        url: payload.url,
      })),
    });
  } catch (err) {
    log.error({ eventId, type, err }, "Failed to create in-app notifications");
  }
}
