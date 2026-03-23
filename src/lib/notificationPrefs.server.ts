import { prisma } from "./db.server";

export interface NotificationPrefs {
  emailEnabled: boolean;
  pushEnabled: boolean;
  gameInviteEmail: boolean;
  gameInvitePush: boolean;
  gameReminderEmail: boolean;
  gameReminderPush: boolean;
  weeklySummaryEmail: boolean;
  paymentReminderEmail: boolean;
  paymentReminderPush: boolean;
  reminder24h: boolean;
  reminder2h: boolean;
  reminder1h: boolean;
}

const DEFAULTS: NotificationPrefs = {
  emailEnabled: true,
  pushEnabled: true,
  gameInviteEmail: true,
  gameInvitePush: true,
  gameReminderEmail: true,
  gameReminderPush: true,
  weeklySummaryEmail: false,
  paymentReminderEmail: true,
  paymentReminderPush: true,
  reminder24h: true,
  reminder2h: true,
  reminder1h: false,
};

/** Get notification preferences for a user, returning defaults if none are stored */
export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const prefs = await prisma.notificationPreferences.findUnique({
    where: { userId },
  });
  return prefs ?? DEFAULTS;
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
