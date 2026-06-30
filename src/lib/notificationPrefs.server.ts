import { prisma } from "./db.server";
import type { NotificationJobType } from "./notificationQueue.server";
import { DEFAULTS } from "./notificationPrefsDefaults";
import type { NotificationPrefs } from "./notificationPrefsDefaults";

export type { NotificationPrefs } from "./notificationPrefsDefaults";
export { DEFAULTS } from "./notificationPrefsDefaults";

// ── Notification tier classification (ADR 0017) ─────────────────────────────

/** Tier 2 (game-level) types — only sent to Players + opted-in Followers */
const TIER_2_TYPES = new Set<NotificationJobType>([
  "player_joined",
  "player_left",
  "player_joined_bench",
  "player_left_bench",
  "player_left_promoted",
  "game_full",
  "spot_available",
  "reminder",
  "post_game",
  "rsvp_request",
  "bench_promoted_capacity",
  "payment_confirmed",
  "payment_self_reported",
]);

/** Returns true if this notification type is game-level (Tier 2) */
export function isGameLevelNotification(type: NotificationJobType): boolean {
  return TIER_2_TYPES.has(type);
}

/** Get notification preferences for a user, returning defaults if none are stored */
export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const prefs = await prisma.notificationPreferences.findUnique({
    where: { userId },
  });
  return prefs ? { ...DEFAULTS, ...prefs } : DEFAULTS;
}

/** Check if a user wants push for a given job type */
export function wantsPushForJobType(prefs: NotificationPrefs, type: NotificationJobType): boolean {
  if (!prefs.pushEnabled) return false;
  switch (type) {
    case "player_joined":
    case "player_left":
    case "player_joined_bench":
    case "player_left_bench":
    case "player_left_promoted":
    case "game_full":
    case "spot_available":
    case "bench_promoted_capacity":
    case "payment_confirmed":
    case "payment_self_reported":
      return prefs.playerActivityPush;
    case "event_details":
    case "game_cancelled":
    case "game_invite":
    case "recruitment":
    case "few_spots_left":
      return prefs.eventDetailsPush;
    case "reminder":
      return prefs.gameReminderPush;
    case "post_game":
      return prefs.postGamePush;
    default:
      return true;
  }
}

/** Per-event notification override fields from EventFollow */
export interface EventFollowOverrides {
  mutePlayerActivity: boolean | null;
  muteReminders: boolean | null;
  mutePostGame: boolean | null;
  muteEventDetails: boolean | null;
}

/**
 * Resolve whether a notification should be sent, considering per-event overrides
 * and the user's role (Player vs non-Player Follower) per ADR 0017.
 *
 * Resolution order:
 * 1. Per-event override on EventFollow (if not null, wins)
 * 2. Event admin default (if set)
 * 3. Role-based default: non-Players are muted for Tier 2 types
 * 4. Global user preference
 */
export function wantsPushWithOverrides(
  prefs: NotificationPrefs,
  type: NotificationJobType,
  overrides: EventFollowOverrides | null,
  eventDefaults?: Partial<Record<keyof EventFollowOverrides, boolean | null>> | null,
  /** Whether this user is an active Player in the current Game (ADR 0017) */
  isPlayerInCurrentGame?: boolean,
): boolean {
  if (!prefs.pushEnabled) return false;

  // Determine which override/default field applies
  let fieldName: keyof EventFollowOverrides | null = null;
  switch (type) {
    case "player_joined":
    case "player_left":
    case "player_joined_bench":
    case "player_left_bench":
    case "player_left_promoted":
    case "game_full":
    case "spot_available":
    case "bench_promoted_capacity":
    case "payment_confirmed":
    case "payment_self_reported":
      fieldName = "mutePlayerActivity";
      break;
    case "event_details":
    case "game_cancelled":
    case "game_invite":
    case "recruitment":
    case "few_spots_left":
      fieldName = "muteEventDetails";
      break;
    case "reminder":
      fieldName = "muteReminders";
      break;
    case "post_game":
      fieldName = "mutePostGame";
      break;
  }

  // Resolution order: per-user override → event defaults (admin) → role-based default → global preference
  const userOverride = fieldName ? (overrides?.[fieldName] ?? null) : null;
  if (userOverride === true) return false;
  if (userOverride === false) return true;

  const eventDefault = fieldName ? (eventDefaults?.[fieldName] ?? null) : null;
  if (eventDefault === true) return false;
  if (eventDefault === false) return true;

  // ponytail: Role-based default (ADR 0017) — non-Players don't receive Tier 2 by default.
  // Upgrade path: if we add more tiers, this becomes a tier lookup table instead of a boolean.
  if (isPlayerInCurrentGame !== undefined && isGameLevelNotification(type) && !isPlayerInCurrentGame) {
    return false;
  }

  // Fall back to global preference
  return wantsPushForJobType(prefs, type);
}

/** Check if a user wants email reminders for a given reminder type */
export function wantsEmailReminder(prefs: NotificationPrefs, type: "24h" | "2h" | "1h"): boolean {
  if (!prefs.emailEnabled || !prefs.gameReminderEmail) return false;
  if (type === "24h") return prefs.reminder24h;
  if (type === "2h") return prefs.reminder2h;
  return prefs.reminder1h;
}

/** Check if a user wants push reminders for a given reminder type */
export function wantsPushReminder(prefs: NotificationPrefs, type: "24h" | "2h" | "1h"): boolean {
  if (!prefs.pushEnabled || !prefs.gameReminderPush) return false;
  if (type === "24h") return prefs.reminder24h;
  if (type === "2h") return prefs.reminder2h;
  return prefs.reminder1h;
}

/** Check if a user wants game invite emails */
export function wantsGameInviteEmail(prefs: NotificationPrefs): boolean {
  return prefs.emailEnabled && prefs.gameInviteEmail;
}

/** Check if a user wants weekly summary emails */
export function wantsWeeklySummary(prefs: NotificationPrefs): boolean {
  return prefs.emailEnabled && prefs.weeklySummaryEmail;
}

/** Check if a user wants payment reminder emails */
export function wantsPaymentReminderEmail(prefs: NotificationPrefs): boolean {
  return prefs.emailEnabled && prefs.paymentReminderEmail;
}

/** Check if a user wants payment reminder push notifications */
export function wantsPaymentReminderPush(prefs: NotificationPrefs): boolean {
  return prefs.pushEnabled && prefs.paymentReminderPush;
}
