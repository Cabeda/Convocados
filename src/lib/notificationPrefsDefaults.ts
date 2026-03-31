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

export const DEFAULTS: NotificationPrefs = {
  emailEnabled: true,
  pushEnabled: true,
  gameInviteEmail: true,
  gameInvitePush: true,
  gameReminderEmail: true,
  gameReminderPush: true,
  playerActivityPush: true,
  eventDetailsPush: true,
  weeklySummaryEmail: false,
  paymentReminderEmail: true,
  paymentReminderPush: true,
  reminder24h: true,
  reminder2h: true,
  reminder1h: false,
};
