import { describe, it, expect } from "vitest";
import {
  getNotificationPrefs,
  wantsPushForJobType,
  wantsEmailReminder,
  wantsPushReminder,
  wantsGameInviteEmail,
  wantsWeeklySummary,
  wantsPaymentReminderEmail,
  wantsPaymentReminderPush,
  DEFAULTS,
} from "~/lib/notificationPrefs.server";
import type { NotificationPrefs } from "~/lib/notificationPrefs.server";

describe("getNotificationPrefs", () => {
  it("returns defaults when user has no stored prefs", async () => {
    const prefs = await getNotificationPrefs("non-existent-user-id");
    expect(prefs).toEqual(DEFAULTS);
  });
});

describe("wantsPushForJobType", () => {
  it("returns false when push is disabled", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: false };
    expect(wantsPushForJobType(prefs, "player_joined")).toBe(false);
  });

  it("returns playerActivityPush for player activity events", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, playerActivityPush: true };
    expect(wantsPushForJobType(prefs, "player_joined")).toBe(true);
    expect(wantsPushForJobType(prefs, "player_left")).toBe(true);
    expect(wantsPushForJobType(prefs, "player_joined_bench")).toBe(true);
    expect(wantsPushForJobType(prefs, "player_left_bench")).toBe(true);
    expect(wantsPushForJobType(prefs, "player_left_promoted")).toBe(true);
  });

  it("returns eventDetailsPush for event_details", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, eventDetailsPush: false };
    expect(wantsPushForJobType(prefs, "event_details")).toBe(false);
  });

  it("returns gameReminderPush for reminder", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, gameReminderPush: false };
    expect(wantsPushForJobType(prefs, "reminder")).toBe(false);
  });

  it("returns gameReminderPush for post_game", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, gameReminderPush: true };
    expect(wantsPushForJobType(prefs, "post_game")).toBe(true);
  });

  it("returns true for unknown job types", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true };
    expect(wantsPushForJobType(prefs, "unknown_type" as any)).toBe(true);
  });
});

describe("wantsEmailReminder", () => {
  it("returns false when email is disabled", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: false, gameReminderEmail: true };
    expect(wantsEmailReminder(prefs, "24h")).toBe(false);
  });

  it("returns false when gameReminderEmail is false", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: true, gameReminderEmail: false };
    expect(wantsEmailReminder(prefs, "24h")).toBe(false);
  });

  it("returns reminder24h for 24h type", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: true, gameReminderEmail: true, reminder24h: true };
    expect(wantsEmailReminder(prefs, "24h")).toBe(true);
  });

  it("returns reminder2h for 2h type", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: true, gameReminderEmail: true, reminder2h: true };
    expect(wantsEmailReminder(prefs, "2h")).toBe(true);
  });

  it("returns reminder1h for 1h type", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: true, gameReminderEmail: true, reminder1h: true };
    expect(wantsEmailReminder(prefs, "1h")).toBe(true);
  });
});

describe("wantsPushReminder", () => {
  it("returns false when push is disabled", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: false, gameReminderPush: true };
    expect(wantsPushReminder(prefs, "24h")).toBe(false);
  });

  it("returns false when gameReminderPush is false", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, gameReminderPush: false };
    expect(wantsPushReminder(prefs, "24h")).toBe(false);
  });

  it("returns reminder24h for 24h type", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, gameReminderPush: true, reminder24h: true };
    expect(wantsPushReminder(prefs, "24h")).toBe(true);
  });

  it("returns reminder2h for 2h type", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, gameReminderPush: true, reminder2h: true };
    expect(wantsPushReminder(prefs, "2h")).toBe(true);
  });

  it("returns reminder1h for 1h type", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, gameReminderPush: true, reminder1h: true };
    expect(wantsPushReminder(prefs, "1h")).toBe(true);
  });
});

describe("wantsGameInviteEmail", () => {
  it("returns false when email is disabled", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: false, gameInviteEmail: true };
    expect(wantsGameInviteEmail(prefs)).toBe(false);
  });

  it("returns gameInviteEmail value", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: true, gameInviteEmail: true };
    expect(wantsGameInviteEmail(prefs)).toBe(true);
  });
});

describe("wantsWeeklySummary", () => {
  it("returns false when email is disabled", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: false, weeklySummaryEmail: true };
    expect(wantsWeeklySummary(prefs)).toBe(false);
  });

  it("returns weeklySummaryEmail value", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: true, weeklySummaryEmail: true };
    expect(wantsWeeklySummary(prefs)).toBe(true);
  });
});

describe("wantsPaymentReminderEmail", () => {
  it("returns false when email is disabled", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: false, paymentReminderEmail: true };
    expect(wantsPaymentReminderEmail(prefs)).toBe(false);
  });

  it("returns paymentReminderEmail value", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, emailEnabled: true, paymentReminderEmail: true };
    expect(wantsPaymentReminderEmail(prefs)).toBe(true);
  });
});

describe("wantsPaymentReminderPush", () => {
  it("returns false when push is disabled", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: false, paymentReminderPush: true };
    expect(wantsPaymentReminderPush(prefs)).toBe(false);
  });

  it("returns paymentReminderPush value", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, paymentReminderPush: true };
    expect(wantsPaymentReminderPush(prefs)).toBe(true);
  });
});
