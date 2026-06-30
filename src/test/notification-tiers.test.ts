/**
 * ADR 0017 — Notification tiers: role-aware defaults and new notification types.
 * Tests the core tier classification, role-aware resolution, and new notification types.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  wantsPushWithOverrides,
  wantsPushForJobType,
  isGameLevelNotification,
  DEFAULTS,
} from "~/lib/notificationPrefs.server";
import type { NotificationPrefs, EventFollowOverrides } from "~/lib/notificationPrefs.server";
import type { NotificationJobType } from "~/lib/notificationQueue.server";

const allNull: EventFollowOverrides = {
  mutePlayerActivity: null,
  muteReminders: null,
  mutePostGame: null,
  muteEventDetails: null,
};

const allPrefs: NotificationPrefs = {
  ...DEFAULTS,
  pushEnabled: true,
  playerActivityPush: true,
  eventDetailsPush: true,
  gameReminderPush: true,
  postGamePush: true,
};

// ── Tier classification ──────────────────────────────────────────────────────

describe("isGameLevelNotification — tier classification", () => {
  const tier2Types: NotificationJobType[] = [
    "player_joined", "player_left", "player_joined_bench", "player_left_bench",
    "player_left_promoted", "game_full", "spot_available", "reminder",
    "post_game", "rsvp_request", "bench_promoted_capacity", "payment_confirmed",
  ];

  const tier1Types: NotificationJobType[] = [
    "event_details", "game_cancelled", "game_invite", "recruitment", "few_spots_left",
  ];

  it.each(tier2Types)("%s is Tier 2 (game-level)", (type) => {
    expect(isGameLevelNotification(type)).toBe(true);
  });

  it.each(tier1Types)("%s is Tier 1 (event-level)", (type) => {
    expect(isGameLevelNotification(type)).toBe(false);
  });
});

// ── wantsPushForJobType — new types ──────────────────────────────────────────

describe("wantsPushForJobType — new notification types", () => {
  it("game_cancelled uses eventDetailsPush", () => {
    expect(wantsPushForJobType({ ...allPrefs, eventDetailsPush: true }, "game_cancelled")).toBe(true);
    expect(wantsPushForJobType({ ...allPrefs, eventDetailsPush: false }, "game_cancelled")).toBe(false);
  });

  it("game_invite uses eventDetailsPush", () => {
    expect(wantsPushForJobType({ ...allPrefs, eventDetailsPush: true }, "game_invite")).toBe(true);
    expect(wantsPushForJobType({ ...allPrefs, eventDetailsPush: false }, "game_invite")).toBe(false);
  });

  it("recruitment uses eventDetailsPush", () => {
    expect(wantsPushForJobType({ ...allPrefs, eventDetailsPush: true }, "recruitment")).toBe(true);
    expect(wantsPushForJobType({ ...allPrefs, eventDetailsPush: false }, "recruitment")).toBe(false);
  });

  it("few_spots_left uses eventDetailsPush", () => {
    expect(wantsPushForJobType({ ...allPrefs, eventDetailsPush: true }, "few_spots_left")).toBe(true);
    expect(wantsPushForJobType({ ...allPrefs, eventDetailsPush: false }, "few_spots_left")).toBe(false);
  });

  it("bench_promoted_capacity uses playerActivityPush", () => {
    expect(wantsPushForJobType({ ...allPrefs, playerActivityPush: true }, "bench_promoted_capacity")).toBe(true);
    expect(wantsPushForJobType({ ...allPrefs, playerActivityPush: false }, "bench_promoted_capacity")).toBe(false);
  });

  it("payment_confirmed uses playerActivityPush", () => {
    expect(wantsPushForJobType({ ...allPrefs, playerActivityPush: true }, "payment_confirmed")).toBe(true);
    expect(wantsPushForJobType({ ...allPrefs, playerActivityPush: false }, "payment_confirmed")).toBe(false);
  });
});

// ── Role-aware resolution (wantsPushWithOverrides) ───────────────────────────

describe("wantsPushWithOverrides — role-aware tier filtering", () => {
  describe("Non-Player Follower (isPlayerInCurrentGame=false)", () => {
    it("receives Tier 1 notifications (event_details)", () => {
      expect(wantsPushWithOverrides(allPrefs, "event_details", allNull, null, false)).toBe(true);
    });

    it("receives Tier 1 notifications (game_cancelled)", () => {
      expect(wantsPushWithOverrides(allPrefs, "game_cancelled", allNull, null, false)).toBe(true);
    });

    it("receives Tier 1 notifications (game_invite)", () => {
      expect(wantsPushWithOverrides(allPrefs, "game_invite", allNull, null, false)).toBe(true);
    });

    it("receives Tier 1 notifications (recruitment)", () => {
      expect(wantsPushWithOverrides(allPrefs, "recruitment", allNull, null, false)).toBe(true);
    });

    it("receives Tier 1 notifications (few_spots_left)", () => {
      expect(wantsPushWithOverrides(allPrefs, "few_spots_left", allNull, null, false)).toBe(true);
    });

    it("does NOT receive Tier 2 (player_joined)", () => {
      expect(wantsPushWithOverrides(allPrefs, "player_joined", allNull, null, false)).toBe(false);
    });

    it("does NOT receive Tier 2 (reminder)", () => {
      expect(wantsPushWithOverrides(allPrefs, "reminder", allNull, null, false)).toBe(false);
    });

    it("does NOT receive Tier 2 (post_game)", () => {
      expect(wantsPushWithOverrides(allPrefs, "post_game", allNull, null, false)).toBe(false);
    });

    it("does NOT receive Tier 2 (game_full)", () => {
      expect(wantsPushWithOverrides(allPrefs, "game_full", allNull, null, false)).toBe(false);
    });

    it("does NOT receive Tier 2 (spot_available)", () => {
      expect(wantsPushWithOverrides(allPrefs, "spot_available", allNull, null, false)).toBe(false);
    });

    it("does NOT receive Tier 2 (bench_promoted_capacity)", () => {
      expect(wantsPushWithOverrides(allPrefs, "bench_promoted_capacity", allNull, null, false)).toBe(false);
    });

    it("does NOT receive Tier 2 (payment_confirmed)", () => {
      expect(wantsPushWithOverrides(allPrefs, "payment_confirmed", allNull, null, false)).toBe(false);
    });
  });

  describe("Player (isPlayerInCurrentGame=true)", () => {
    it("receives Tier 1 notifications", () => {
      expect(wantsPushWithOverrides(allPrefs, "event_details", allNull, null, true)).toBe(true);
      expect(wantsPushWithOverrides(allPrefs, "game_cancelled", allNull, null, true)).toBe(true);
    });

    it("receives Tier 2 notifications", () => {
      expect(wantsPushWithOverrides(allPrefs, "player_joined", allNull, null, true)).toBe(true);
      expect(wantsPushWithOverrides(allPrefs, "reminder", allNull, null, true)).toBe(true);
      expect(wantsPushWithOverrides(allPrefs, "post_game", allNull, null, true)).toBe(true);
      expect(wantsPushWithOverrides(allPrefs, "game_full", allNull, null, true)).toBe(true);
      expect(wantsPushWithOverrides(allPrefs, "spot_available", allNull, null, true)).toBe(true);
    });
  });

  describe("Non-Player with force-enable overrides (full notifications opt-in)", () => {
    it("receives Tier 2 when mutePlayerActivity=false", () => {
      const overrides: EventFollowOverrides = { ...allNull, mutePlayerActivity: false };
      expect(wantsPushWithOverrides(allPrefs, "player_joined", overrides, null, false)).toBe(true);
      expect(wantsPushWithOverrides(allPrefs, "game_full", overrides, null, false)).toBe(true);
    });

    it("receives Tier 2 when muteReminders=false", () => {
      const overrides: EventFollowOverrides = { ...allNull, muteReminders: false };
      expect(wantsPushWithOverrides(allPrefs, "reminder", overrides, null, false)).toBe(true);
    });

    it("receives Tier 2 when mutePostGame=false", () => {
      const overrides: EventFollowOverrides = { ...allNull, mutePostGame: false };
      expect(wantsPushWithOverrides(allPrefs, "post_game", overrides, null, false)).toBe(true);
    });
  });

  describe("Player with mute overrides", () => {
    it("Player can mute Tier 2 notifications", () => {
      const overrides: EventFollowOverrides = { ...allNull, mutePlayerActivity: true };
      expect(wantsPushWithOverrides(allPrefs, "player_joined", overrides, null, true)).toBe(false);
    });

    it("Player can mute Tier 1 notifications via muteEventDetails", () => {
      const overrides: EventFollowOverrides = { ...allNull, muteEventDetails: true };
      expect(wantsPushWithOverrides(allPrefs, "event_details", overrides, null, true)).toBe(false);
      expect(wantsPushWithOverrides(allPrefs, "game_cancelled", overrides, null, true)).toBe(false);
    });
  });

  describe("Event admin defaults interact with role-based defaults", () => {
    it("event admin default mutePlayerActivity=true mutes Player", () => {
      const eventDefaults = { mutePlayerActivity: true };
      expect(wantsPushWithOverrides(allPrefs, "player_joined", allNull, eventDefaults, true)).toBe(false);
    });

    it("event admin default mutePlayerActivity=false enables non-Player", () => {
      const eventDefaults = { mutePlayerActivity: false };
      expect(wantsPushWithOverrides(allPrefs, "player_joined", allNull, eventDefaults, false)).toBe(true);
    });

    it("per-user override beats event admin default", () => {
      const overrides: EventFollowOverrides = { ...allNull, mutePlayerActivity: false };
      const eventDefaults = { mutePlayerActivity: true };
      expect(wantsPushWithOverrides(allPrefs, "player_joined", overrides, eventDefaults, false)).toBe(true);
    });
  });

  describe("pushEnabled=false always blocks", () => {
    const disabledPrefs = { ...allPrefs, pushEnabled: false };

    it("blocks Tier 1 even for Players", () => {
      expect(wantsPushWithOverrides(disabledPrefs, "event_details", allNull, null, true)).toBe(false);
    });

    it("blocks Tier 2 even for Players", () => {
      expect(wantsPushWithOverrides(disabledPrefs, "player_joined", allNull, null, true)).toBe(false);
    });

    it("blocks even with force-enable override", () => {
      const overrides: EventFollowOverrides = { ...allNull, mutePlayerActivity: false };
      expect(wantsPushWithOverrides(disabledPrefs, "player_joined", overrides, null, false)).toBe(false);
    });
  });

  describe("backwards-compatibility (isPlayerInCurrentGame omitted)", () => {
    it("falls through to global preference (existing behavior)", () => {
      expect(wantsPushWithOverrides(allPrefs, "player_joined", allNull, null)).toBe(true);
      expect(wantsPushWithOverrides(allPrefs, "reminder", allNull, null)).toBe(true);
    });

    it("still respects mute overrides", () => {
      const overrides: EventFollowOverrides = { ...allNull, mutePlayerActivity: true };
      expect(wantsPushWithOverrides(allPrefs, "player_joined", overrides, null)).toBe(false);
    });
  });
});

// ── muteEventDetails now covers new Tier 1 types ─────────────────────────────

describe("muteEventDetails coverage for new Tier 1 types", () => {
  it("game_cancelled is muted by muteEventDetails=true", () => {
    const overrides: EventFollowOverrides = { ...allNull, muteEventDetails: true };
    expect(wantsPushWithOverrides(allPrefs, "game_cancelled", overrides, null, true)).toBe(false);
  });

  it("game_invite is muted by muteEventDetails=true", () => {
    const overrides: EventFollowOverrides = { ...allNull, muteEventDetails: true };
    expect(wantsPushWithOverrides(allPrefs, "game_invite", overrides, null, true)).toBe(false);
  });

  it("recruitment is muted by muteReminders=true (uses muteEventDetails field)", () => {
    // recruitment maps to muteEventDetails field in the switch
    const overrides: EventFollowOverrides = { ...allNull, muteEventDetails: true };
    expect(wantsPushWithOverrides(allPrefs, "recruitment", overrides, null, false)).toBe(false);
  });

  it("few_spots_left is muted by muteEventDetails=true", () => {
    const overrides: EventFollowOverrides = { ...allNull, muteEventDetails: true };
    expect(wantsPushWithOverrides(allPrefs, "few_spots_left", overrides, null, false)).toBe(false);
  });
});



// ── few_spots_left dedup and admin auto-follow tests ─────────────────────────

import { prisma } from "~/lib/db.server";

async function seedUser(name: string, id?: string) {
  return prisma.user.create({ data: { id: id ?? `u-${name}`, name, email: `${name}@test.com`, emailVerified: true } });
}

async function seedEvent(ownerId: string | null = null, overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 5,
      ownerId,
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await prisma.eventFollow.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("fewSpotsLeftNotified dedup flag", () => {
  it("defaults to false on event creation", async () => {
    const event = await seedEvent();
    expect(event.fewSpotsLeftNotified).toBe(false);
  });

  it("can be set to true and read back", async () => {
    const event = await seedEvent();
    await prisma.event.update({ where: { id: event.id }, data: { fewSpotsLeftNotified: true } });
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.fewSpotsLeftNotified).toBe(true);
  });

  it("can be reset to false", async () => {
    const event = await seedEvent();
    await prisma.event.update({ where: { id: event.id }, data: { fewSpotsLeftNotified: true } });
    await prisma.event.update({ where: { id: event.id }, data: { fewSpotsLeftNotified: false } });
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.fewSpotsLeftNotified).toBe(false);
  });
});

describe("Admin auto-follow preserves existing preferences on re-grant", () => {
  it("creates follow with full notifications on first grant", async () => {
    const owner = await seedUser("Owner", "owner");
    const admin = await seedUser("Admin", "admin");
    const event = await seedEvent(owner.id);

    // Simulate admin grant auto-follow (same as admins.ts logic)
    await prisma.eventFollow.upsert({
      where: { eventId_userId: { eventId: event.id, userId: admin.id } },
      create: { eventId: event.id, userId: admin.id, mutePlayerActivity: false, muteReminders: false, mutePostGame: false, muteEventDetails: false },
      update: {},
    });

    const follow = await prisma.eventFollow.findUnique({ where: { eventId_userId: { eventId: event.id, userId: admin.id } } });
    expect(follow?.mutePlayerActivity).toBe(false);
    expect(follow?.muteReminders).toBe(false);
    expect(follow?.mutePostGame).toBe(false);
    expect(follow?.muteEventDetails).toBe(false);
  });

  it("does NOT override existing preferences on re-grant", async () => {
    const owner = await seedUser("Owner", "owner");
    const admin = await seedUser("Admin", "admin");
    const event = await seedEvent(owner.id);

    // Admin already follows with custom preferences
    await prisma.eventFollow.create({
      data: { eventId: event.id, userId: admin.id, mutePlayerActivity: true, muteReminders: null, mutePostGame: null, muteEventDetails: null },
    });

    // Re-grant admin — upsert with empty update should NOT change existing prefs
    await prisma.eventFollow.upsert({
      where: { eventId_userId: { eventId: event.id, userId: admin.id } },
      create: { eventId: event.id, userId: admin.id, mutePlayerActivity: false, muteReminders: false, mutePostGame: false, muteEventDetails: false },
      update: {},
    });

    const follow = await prisma.eventFollow.findUnique({ where: { eventId_userId: { eventId: event.id, userId: admin.id } } });
    // mutePlayerActivity should still be true (the admin's explicit choice)
    expect(follow?.mutePlayerActivity).toBe(true);
  });
});
