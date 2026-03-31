import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import type { TranslationKey } from "./i18n";

const log = createLogger("notification-queue");

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).notificationJob
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

/** Drain pending notification jobs — called by the cron endpoint */
export async function drainNotificationQueue(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobs: any[] = await (prisma as any).notificationJob.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  if (jobs.length === 0) return 0;

  // Lazy import to avoid circular dependency (push.server imports notificationPrefs which is fine)
  const { sendPushToEvent } = await import("./push.server");

  await Promise.allSettled(
    jobs.map(async (job: { id: string; eventId: string; type: string; payload: string; senderClientId: string | null }) => {
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
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma as any).notificationJob
          .update({ where: { id: job.id }, data: { processedAt: new Date() } })
          .catch(() => {});
      }
    }),
  );

  return jobs.length;
}
