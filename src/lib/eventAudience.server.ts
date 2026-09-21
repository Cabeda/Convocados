/**
 * Event notification audience — the single seam that resolves "who receives an
 * event notification". Recipients are the Event's Followers plus the Owner
 * (always, implicit follow), minus any explicit exclusions, minus — for ping
 * types — users who declined the current game or opted out of invites (ADR 0025).
 *
 * Followers' per-event mute overrides and the Event's notification defaults are
 * returned alongside so callers can apply the ADR 0017 resolution order without
 * re-querying.
 */
import { prisma } from "./db.server";
import { getPingSuppressedUserIds } from "./inviteOptOut.server";

export interface EventFollowOverrides {
  userId: string;
  mutePlayerActivity: boolean | null;
  muteReminders: boolean | null;
  mutePostGame: boolean | null;
  muteEventDetails: boolean | null;
}

export interface EventNotificationDefaults {
  mutePlayerActivity?: boolean | null;
  muteReminders?: boolean | null;
  mutePostGame?: boolean | null;
  muteEventDetails?: boolean | null;
}

export interface EventAudience {
  /** Final recipient user ids after owner inclusion and exclusions. */
  userIds: string[];
  /** The raw EventFollow rows (for per-user mute overrides). */
  follows: EventFollowOverrides[];
  ownerId: string | null;
  notificationDefaults: EventNotificationDefaults | null;
}

/**
 * Notification types subject to ADR 0025 ping suppression: users who declined
 * the current game or opted out of invites are not re-prompted.
 */
export function isPingSuppressedType(type: string): boolean {
  return type === "recruitment" || type === "few_spots_left" || type === "spot_available";
}

export interface ResolveEventAudienceOptions {
  /** Include the Event Owner even when they do not follow. Default true. */
  includeOwner?: boolean;
  /** User ids to remove from the audience (e.g. the sender). */
  excludeUserIds?: Iterable<string>;
  /** Apply ADR 0025 ping suppression (declined / opted-out users). */
  suppressPingDeclines?: boolean;
}

export async function resolveEventAudience(
  eventId: string,
  opts: ResolveEventAudienceOptions = {},
): Promise<EventAudience> {
  const [follows, event] = await Promise.all([
    prisma.eventFollow.findMany({
      where: { eventId },
      select: {
        userId: true,
        mutePlayerActivity: true,
        muteReminders: true,
        mutePostGame: true,
        muteEventDetails: true,
      },
    }),
    prisma.event.findUnique({
      where: { id: eventId },
      select: { ownerId: true, notificationDefaults: true },
    }),
  ]);

  const notificationDefaults = event?.notificationDefaults
    ? (JSON.parse(event.notificationDefaults) as EventNotificationDefaults)
    : null;

  const recipientIds = new Set(follows.map((f) => f.userId));
  if ((opts.includeOwner ?? true) && event?.ownerId) recipientIds.add(event.ownerId);
  for (const id of opts.excludeUserIds ?? []) recipientIds.delete(id);

  if (opts.suppressPingDeclines) {
    const suppressed = await getPingSuppressedUserIds(eventId);
    for (const id of suppressed) recipientIds.delete(id);
  }

  return {
    userIds: [...recipientIds],
    follows,
    ownerId: event?.ownerId ?? null,
    notificationDefaults,
  };
}
