/** #457 RSVP answer notifications. */

import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import type { TranslationKey } from "./i18n";
import type { RsvpStatusValue } from "./rsvp";

const log = createLogger("rsvp-notifications");

/**
 * Enqueue a notification announcing an RSVP answer.
 *
 * - For a logged actor (self-RSVP via the user endpoint) the payload carries the
 *   actor's name and a per-status i18n key like `notifyRsvpAnswerYes`.
 * - For an anonymous actor (an admin setting a guest RSVP) the payload uses a
 *   generic key `notifyRsvpAnswerAnon` so we don't expose the guest's identity.
 *
 * Dedup: a single unprocessed `rsvp_request` job per (eventId, actorKey) is
 * kept. Subsequent calls for the same actor update the existing job's payload
 * in place (latest-wins). Processed or failed jobs are not touched — once
 * delivered, a new change is a new event.
 */
export async function enqueueRsvpAnswerNotification(params: {
  eventId: string;
  eventTitle: string;
  status: RsvpStatusValue;
  actorUserId?: string | null;
  actorPlayerId?: string | null;
  actorName?: string | null;
  actorIsLogged: boolean;
  /** userId of the actor when the actor is anonymous (admin acting on a guest's behalf).
   *  This is used to suppress the notification being echoed back to the admin.
   *  For a logged actor (self-RSVP), defaults to actorUserId so we never echo back. */
  senderClientId?: string | null;
}): Promise<void> {
  const { eventId, eventTitle, status, actorUserId, actorPlayerId, actorName, actorIsLogged, senderClientId: explicitSender } = params;
  const senderClientId = explicitSender ?? (actorIsLogged ? actorUserId ?? null : null);

  const actorKey = actorUserId
    ? `user:${actorUserId}`
    : actorPlayerId
      ? `player:${actorPlayerId}`
      : null;
  if (!actorKey) {
    log.warn({ eventId, status }, "enqueueRsvpAnswerNotification called without actor key");
    return;
  }

  const paramsRecord: Record<string, string> = { title: eventTitle };
  let key: TranslationKey;
  if (actorIsLogged && actorName) {
    paramsRecord.name = actorName;
    if (status === "yes") key = "notifyRsvpAnswerYes";
    else if (status === "no") key = "notifyRsvpAnswerNo";
    else key = "notifyRsvpAnswerMaybe";
  } else {
    key = "notifyRsvpAnswerAnon";
  }

  const payload = JSON.stringify({ title: eventTitle, key, params: paramsRecord, url: `/events/${eventId}`, spotsLeft: 0 });

  const existing = await prisma.notificationJob.findFirst({
    where: {
      eventId,
      type: "rsvp_request",
      processedAt: null,
      failedAt: null,
      payload: { contains: `"actorKey":"${actorKey}"` },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.notificationJob.update({
      where: { id: existing.id },
      data: { payload, senderClientId: senderClientId ?? null },
    });
    return;
  }

  await prisma.notificationJob.create({
    data: {
      eventId,
      type: "rsvp_request",
      payload: JSON.stringify({ title: eventTitle, key, params: paramsRecord, url: `/events/${eventId}`, spotsLeft: 0, actorKey }),
      senderClientId: senderClientId ?? null,
    },
  }).catch((err: unknown) => {
    log.error({ eventId, err }, "Failed to enqueue rsvp_request notification");
  });
}
