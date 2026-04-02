/** Shared notification preferences interface and defaults — safe to import in client components */

export interface NotificationPrefs {
  emailEnabled: boolean;
  pushEnabled: boolean;
  gameInviteEmail: boolean;
  gameInvitePush: boolean;
  gameReminderEmail: boolean;
  gameReminderPush: boolean;
  playerActivityPush: boolean;
  eventDetailsPush: boolean;
  weeklySummaryEmail: boolean;
  paymentReminderEmail: boolean;
  paymentReminderPush: boolean;
  reminder24h: boolean;
  reminder2h: boolean;
  reminder1h: boolean;
}

/**
 * Default preferences for new users.
 * Email is off by default — push (web + future app) is the primary channel.
 * Users can opt-in to email in their settings.
 */
export const DEFAULTS: NotificationPrefs = {
  emailEnabled: false,
  pushEnabled: true,
  gameInviteEmail: false,
  gameInvitePush: true,
  gameReminderEmail: false,
  gameReminderPush: true,
  playerActivityPush: true,
  eventDetailsPush: true,
  weeklySummaryEmail: false,
  paymentReminderEmail: false,
  paymentReminderPush: true,
  reminder24h: true,
  reminder2h: true,
  reminder1h: false,
};
