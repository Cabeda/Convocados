/**
 * Event notification audience — the single seam that resolves "who receives an
 * event notification". Recipients are the Event's Followers plus the Owner
 * (always, implicit follow), minus any explicit exclusions, minus — for ping
 * types — users who declined the current game or opted out of invites (ADR 0025).
 *
 * Followers' per-event mute overrides and the Event's notification defaults are
 * returned alongside so callers can apply the ADR 0017 resolution order without
 * re-querying.
 *
 * {@link resolveJobAudience} is the job-scoped form: it applies that resolution
 * order once, so every channel reads the same recipient list off the same
 * verdict instead of re-deriving it.
 */
import { prisma } from "./db.server";
import { getPingSuppressedUserIds } from "./inviteOptOut.server";
import { resolveMuteTier, type MuteTierDecision } from "./notificationPrefs.server";
import type { NotificationJobType } from "./notificationQueue.server";

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

/** One drained job's audience, resolved once and shared by every channel. */
export interface JobAudience {
  eventId: string;
  /** Followers + Owner − exclusions − ping suppressions, in one list. */
  userIds: string[];
  /**
   * The ADR 0004 mute / ADR 0017 role-tier verdict per recipient. The in-app feed
   * stops at `"vetoed"`; push adds its own transport preference on top.
   */
  decisions: Map<string, MuteTierDecision>;
}

/**
 * Resolve the audience for one notification job — the recipient list plus the
 * mute + role-tier verdict for each of them, computed exactly once.
 *
 * Pass the result to every channel the job fans out to. A channel that needs
 * fewer queries must not also be allowed to reach a different answer: the
 * in-app feed reads `decisions`, push reads the same map plus its transport
 * preference, and neither re-queries.
 *
 * `type` is optional because a direct `sendPushToEvent` without a jobType has
 * always meant "deliver to the audience, filter by nothing" — so there is no
 * verdict to reach and the map comes back empty.
 */
export async function resolveJobAudience(
  eventId: string,
  type: NotificationJobType | undefined,
  opts: ResolveEventAudienceOptions = {},
): Promise<JobAudience> {
  const [{ userIds, follows, notificationDefaults }, activePlayers] = await Promise.all([
    resolveEventAudience(eventId, {
      ...opts,
      suppressPingDeclines: type ? isPingSuppressedType(type) : false,
    }),
    prisma.player.findMany({
      where: { eventId, archivedAt: null, userId: { not: null } },
      select: { userId: true },
    }),
  ]);

  const playerUserIds = new Set(activePlayers.map((p) => p.userId as string));
  const overridesByUser = new Map(follows.map((f) => [f.userId, f]));
  const decisions = new Map<string, MuteTierDecision>(
    userIds.map((userId) => [
      userId,
      type
        ? resolveMuteTier(type, overridesByUser.get(userId) ?? null, notificationDefaults, playerUserIds.has(userId))
        : "open",
    ]),
  );

  return { eventId, userIds, decisions };
}
