import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import type { TranslationKey } from "./i18n";

const log = createLogger("notification-queue");

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;

export type NotificationJobType =
  | "player_joined"
  | "player_left"
  | "player_joined_bench"
  | "player_left_bench"
  | "player_left_promoted"
  | "event_details"
  | "reminder";

export interface NotificationJobPayload {
  title: string;
  key: TranslationKey;
  params: Record<string, string>;
  url: string;
  spotsLeft: number;
  /** Only set for "reminder" jobs — used to check per-timing push prefs */
  reminderType?: "24h" | "2h" | "1h";
}

/** Enqueue a notification job — fire and forget, never blocks the caller */
export function enqueueNotification(
  eventId: string,
  type: NotificationJobType,
  payload: NotificationJobPayload,
  senderClientId?: string,
): void {
  prisma.notificationJob
    .create({
      data: {
        eventId,
        type,
        payload: JSON.stringify(payload),
        senderClientId: senderClientId ?? null,
      },
    })
    .catch((err: unknown) => log.error({ eventId, type, err }, "Failed to enqueue notification job"));
}

/** Drain pending notification jobs — called by the cron endpoint.
 *
 *  Uses a transaction to atomically claim each batch, preventing double-delivery
 *  when the cron fires concurrently. Failed jobs are retried up to MAX_RETRIES
 *  times; after that they are moved to the dead-letter state (failedAt set).
 */
export async function drainNotificationQueue(): Promise<number> {
  // Lazy import to avoid circular dependency
  const { sendPushToEvent } = await import("./push.server");

  let totalProcessed = 0;

  while (true) {
    // Atomically claim a batch inside a transaction so concurrent runs can't
    // pick up the same jobs.
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
      return tx.notificationJob.findMany({
        where: { id: { in: ids } },
      });
    });

    if (jobs.length === 0) break;

    await Promise.allSettled(
      jobs.map(async (job) => {
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
            // Dead-letter: mark as permanently failed
            await prisma.notificationJob
              .update({ where: { id: job.id }, data: { failedAt: new Date(), processedAt: null } })
              .catch(() => {});
            log.error({ jobId: job.id }, "Notification job moved to dead-letter after max retries");
          } else {
            // Reset for retry
            await prisma.notificationJob
              .update({ where: { id: job.id }, data: { processedAt: null, retryCount: nextRetry } })
              .catch(() => {});
          }
        }
      }),
    );

    totalProcessed += jobs.length;
    if (jobs.length < BATCH_SIZE) break;
  }

  return totalProcessed;
}
