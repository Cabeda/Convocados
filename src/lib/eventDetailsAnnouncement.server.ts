import { createLogger } from "./logger.server";
import { drainNotificationQueue, enqueueNotification } from "./notificationQueue.server";
import { getRosterCapacity } from "./roster.server";
import { fireWebhooks } from "./webhook.server";

const log = createLogger("event-details-announcement");

interface EventDetailsChange {
  id: string;
  title: string;
  maxPlayers: number;
  currentGameId?: string | null;
}

/**
 * Tell the group a game's time or place changed: fire the reschedule webhook,
 * queue one event_details push with the current roster's spotsLeft, then drain
 * so the push is sent before the request returns.
 */
export async function announceEventDetailsChange(
  event: EventDetailsChange,
  senderClientId?: string,
): Promise<void> {
  fireWebhooks(event.id, "game_rescheduled", {}).catch(() => {});
  const { spotsLeft } = await getRosterCapacity(event.id, event.maxPlayers, event.currentGameId);
  await enqueueNotification(event.id, "event_details", {
    title: event.title,
    key: "notifyEventDetailsChanged",
    params: { title: event.title },
    url: `/events/${event.id}`,
    spotsLeft,
  }, senderClientId);

  if (!process.env.VITEST) {
    await drainNotificationQueue().catch((err) => {
      log.error({ eventId: event.id, err }, "Failed to drain notification queue");
    });
  }
}
