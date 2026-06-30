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


import { wantsPushWithOverrides, isGameLevelNotification } from "~/lib/notificationPrefs.server";
import type { EventFollowOverrides } from "~/lib/notificationPrefs.server";

describe("isGameLevelNotification", () => {
  it("classifies player activity as Tier 2", () => {
    expect(isGameLevelNotification("player_joined")).toBe(true);
    expect(isGameLevelNotification("player_left")).toBe(true);
    expect(isGameLevelNotification("game_full")).toBe(true);
    expect(isGameLevelNotification("spot_available")).toBe(true);
    expect(isGameLevelNotification("reminder")).toBe(true);
    expect(isGameLevelNotification("post_game")).toBe(true);
  });

  it("classifies event_details as Tier 1", () => {
    expect(isGameLevelNotification("event_details")).toBe(false);
  });
});

describe("wantsPushWithOverrides — role-aware (ADR 0017)", () => {
  const allNull: EventFollowOverrides = {
    mutePlayerActivity: null,
    muteReminders: null,
    mutePostGame: null,
    muteEventDetails: null,
  };

  it("non-Player is muted for Tier 2 when overrides are null", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, playerActivityPush: true };
    expect(wantsPushWithOverrides(prefs, "player_joined", allNull, null, false)).toBe(false);
    expect(wantsPushWithOverrides(prefs, "reminder", allNull, null, false)).toBe(false);
    expect(wantsPushWithOverrides(prefs, "post_game", allNull, null, false)).toBe(false);
  });

  it("Player receives Tier 2 when overrides are null", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, playerActivityPush: true };
    expect(wantsPushWithOverrides(prefs, "player_joined", allNull, null, true)).toBe(true);
    expect(wantsPushWithOverrides(prefs, "reminder", allNull, null, true)).toBe(true);
    expect(wantsPushWithOverrides(prefs, "post_game", allNull, null, true)).toBe(true);
  });

  it("non-Player still receives Tier 1 (event_details)", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, eventDetailsPush: true };
    expect(wantsPushWithOverrides(prefs, "event_details", allNull, null, false)).toBe(true);
  });

  it("non-Player with force-enable override receives Tier 2", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true };
    const overrides: EventFollowOverrides = { ...allNull, mutePlayerActivity: false };
    expect(wantsPushWithOverrides(prefs, "player_joined", overrides, null, false)).toBe(true);
  });

  it("Player with mute override is muted for Tier 2", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, playerActivityPush: true };
    const overrides: EventFollowOverrides = { ...allNull, mutePlayerActivity: true };
    expect(wantsPushWithOverrides(prefs, "player_joined", overrides, null, true)).toBe(false);
  });

  it("backwards-compatible: omitting isPlayerInCurrentGame falls through to global prefs", () => {
    const prefs: NotificationPrefs = { ...DEFAULTS, pushEnabled: true, playerActivityPush: true };
    // No 5th argument — old call sites remain unaffected
    expect(wantsPushWithOverrides(prefs, "player_joined", allNull, null)).toBe(true);
  });
});
