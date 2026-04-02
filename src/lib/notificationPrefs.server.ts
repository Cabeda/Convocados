import { prisma } from "./db.server";
import type { NotificationJobType } from "./notificationQueue.server";
import { DEFAULTS } from "./notificationPrefsDefaults";
import type { NotificationPrefs } from "./notificationPrefsDefaults";

export type { NotificationPrefs } from "./notificationPrefsDefaults";
export { DEFAULTS } from "./notificationPrefsDefaults";

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
      return prefs.playerActivityPush;
    case "event_details":
      return prefs.eventDetailsPush;
    case "reminder":
      return prefs.gameReminderPush;
    case "post_game":
      return prefs.gameReminderPush;
    default:
      return true;
  }
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
