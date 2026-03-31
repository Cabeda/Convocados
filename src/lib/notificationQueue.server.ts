import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import type { TranslationKey } from "./i18n";

const log = createLogger("notification-queue");

const BATCH_SIZE = 100;

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
 *  Atomically claims each batch by setting processedAt before processing,
 *  preventing double-delivery if the cron fires concurrently.
 */
export async function drainNotificationQueue(): Promise<number> {
  // Lazy import to avoid circular dependency
  const { sendPushToEvent } = await import("./push.server");

  let totalProcessed = 0;

  // Loop in batches until no unprocessed jobs remain
  while (true) {
    // Atomically claim a batch: mark processedAt now so concurrent runs skip them
    const claimTime = new Date();
    const claimed = await prisma.notificationJob.updateMany({
      where: { processedAt: null },
      data: { processedAt: claimTime },
    });

    if (claimed.count === 0) break;

    // Fetch the batch we just claimed
    const jobs = await prisma.notificationJob.findMany({
      where: { processedAt: claimTime },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
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
          );
        } catch (err: unknown) {
          log.error({ jobId: job.id, eventId: job.eventId, type: job.type, err }, "Failed to process notification job");
        }
      }),
    );

    totalProcessed += jobs.length;

    // If we got fewer than BATCH_SIZE, there are no more jobs
    if (jobs.length < BATCH_SIZE) break;
  }

  return totalProcessed;
}
