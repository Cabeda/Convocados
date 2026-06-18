import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  upsertRsvp,
  getRsvpForUser,
  upsertGuestRsvp,
  getRsvpForGuest,
  getRsvpSummary,
  getRsvpRecipients,
  markRsvpCutoffSent,
  isRsvpCutoffSent,
  getEventsNeedingRsvpPing,
  getEventsNeedingRsvpSummary,
  userHasPendingRsvp,
  userAccountAgeDays,
  recordAppOpen,
  countAppOpenDays,
  setPushPromptState,
  getPushPromptState,
  shouldShowPushPrompt,
  PUSH_PROMPT_COOLDOWN_MS,
  FRESH_ACCOUNT_DAYS,
  APP_OPEN_LOOKBACK_DAYS,
  APP_OPEN_THRESHOLD,
} from "~/lib/rsvp.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(async () => {
  await prisma.rsvp.deleteMany();
  await prisma.userAppOpen.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(overrides: Record<string, unknown> = {}) {
  // Default to an account older than FRESH_ACCOUNT_DAYS so existing tests
  // don't accidentally hit the #463 first-7d onboarding bypass.
  const createdAt = new Date(Date.now() - 30 * 86400_000);
  return prisma.user.create({
    data: {
      id: `u-${Math.random().toString(36).slice(2, 8)}`,
      name: "Alice",
      email: `a-${Math.random().toString(36).slice(2, 8)}@t.com`,
      emailVerified: true,
      createdAt,
      ...overrides,
    },
  });
}

async function seedEvent(ownerId: string | null, overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      id: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 7 * 86400_000),
      ownerId,
      ...overrides,
    },
  });
}

describe("upsertRsvp", () => {
  it("creates a new RSVP row", async () => {
    const user = await seedUser();
    const event = await seedEvent(null);
    const rsvp = await upsertRsvp(event.id, user.id, "yes");
    expect(rsvp.status).toBe("yes");
    expect(rsvp.respondedAt).not.toBeNull();
  });

  it("is idempotent (upsert on userId+eventId)", async () => {
    const user = await seedUser();
    const event = await seedEvent(null);
    await upsertRsvp(event.id, user.id, "yes");
    const rsvp = await upsertRsvp(event.id, user.id, "no");
    expect(rsvp.status).toBe("no");

    const count = await prisma.rsvp.count({ where: { userId: user.id, eventId: event.id } });
    expect(count).toBe(1);
  });
});

describe("getRsvpForUser", () => {
  it("returns null when no row", async () => {
    const user = await seedUser();
    const event = await seedEvent(null);
    const rsvp = await getRsvpForUser(event.id, user.id);
    expect(rsvp).toBeNull();
  });

  it("returns the row when present", async () => {
    const user = await seedUser();
    const event = await seedEvent(null);
    await upsertRsvp(event.id, user.id, "yes");
    const rsvp = await getRsvpForUser(event.id, user.id);
    expect(rsvp?.status).toBe("yes");
  });
});

describe("getRsvpSummary", () => {
  it("counts yes/no/pending correctly across followers + players + owner", async () => {
    const owner = await seedUser({ name: "Owner" });
    const follower = await seedUser({ name: "Follower" });
    const playerUser = await seedUser({ name: "PlayerUser" });
    const stranger = await seedUser({ name: "Stranger" });

    const event = await seedEvent(owner.id);

    // follower follows
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: follower.id } });
    // player linked to event
    await prisma.player.create({ data: { eventId: event.id, name: playerUser.name, userId: playerUser.id, order: 0 } });
    // stranger is a "linked" user via implicit follow? No — they need an EventFollow or Player link.
    // Add a stranger who follows
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: stranger.id } });

    await upsertRsvp(event.id, follower.id, "yes");
    await upsertRsvp(event.id, playerUser.id, "no");
    // owner and stranger are pending (no row)

    const summary = await getRsvpSummary(event.id);
    expect(summary.yes).toBe(1);
    expect(summary.no).toBe(1);
    // pending = 2 (owner + stranger)
    expect(summary.pending).toBe(2);
  });
});

describe("getRsvpRecipients", () => {
  it("resolves followers + linked players + owner, skipping unlinked guests", async () => {
    const owner = await seedUser({ name: "Owner" });
    const follower = await seedUser({ name: "Follower" });
    const playerUser = await seedUser({ name: "PlayerUser" });
    const ghost = await seedUser({ name: "Ghost" });

    const event = await seedEvent(owner.id);
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: follower.id } });
    await prisma.player.create({ data: { eventId: event.id, name: playerUser.name, userId: playerUser.id, order: 0 } });
    // unlinked guest (Player with no userId)
    await prisma.player.create({ data: { eventId: event.id, name: "Guest", order: 1 } });
    // ghost is a user with no follow + no player → not a recipient
    await ghost;

    const recipients = await getRsvpRecipients(event.id);
    expect(recipients.sort()).toEqual([owner.id, follower.id, playerUser.id].sort());
  });

  it("excludes soft-archived players from the recipient set (#XXX off-by-one fix)", async () => {
    const owner = await seedUser({ name: "Owner" });
    const playerUser = await seedUser({ name: "PlayerUser" });
    const event = await seedEvent(owner.id);
    await prisma.player.create({
      data: {
        eventId: event.id,
        name: playerUser.name,
        userId: playerUser.id,
        order: 0,
        archivedAt: new Date(),
      },
    });

    const recipients = await getRsvpRecipients(event.id);
    expect(recipients).toEqual([owner.id]);
  });
});

describe("upsertGuestRsvp", () => {
  it("creates a new RSVP row keyed on playerId with respondedByUserId audit", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedEvent(owner.id);
    const guest = await prisma.player.create({
      data: { eventId: event.id, name: "Guest", order: 0 },
    });

    const rsvp = await upsertGuestRsvp(event.id, guest.id, "yes", owner.id);
    expect(rsvp.status).toBe("yes");
    expect(rsvp.respondedAt).not.toBeNull();
    expect(rsvp.playerId).toBe(guest.id);
    expect(rsvp.userId).toBeNull();
    expect(rsvp.respondedByUserId).toBe(owner.id);
  });

  it("is idempotent on (playerId, eventId)", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedEvent(owner.id);
    const guest = await prisma.player.create({
      data: { eventId: event.id, name: "Guest", order: 0 },
    });

    await upsertGuestRsvp(event.id, guest.id, "yes", owner.id);
    const rsvp = await upsertGuestRsvp(event.id, guest.id, "no", owner.id);
    expect(rsvp.status).toBe("no");

    const count = await prisma.rsvp.count({ where: { playerId: guest.id, eventId: event.id } });
    expect(count).toBe(1);
  });

  it("accepts null status (clears the RSVP)", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedEvent(owner.id);
    const guest = await prisma.player.create({
      data: { eventId: event.id, name: "Guest", order: 0 },
    });

    await upsertGuestRsvp(event.id, guest.id, "yes", owner.id);
    const rsvp = await upsertGuestRsvp(event.id, guest.id, null, owner.id);
    expect(rsvp.status).toBeNull();
    expect(rsvp.respondedAt).toBeNull();
  });

  it("refuses to write a guest RSVP for a linked player (userId set)", async () => {
    const owner = await seedUser({ name: "Owner" });
    const linked = await seedUser({ name: "Linked" });
    const event = await seedEvent(owner.id);
    const linkedPlayer = await prisma.player.create({
      data: { eventId: event.id, name: linked.name, userId: linked.id, order: 0 },
    });

    await expect(upsertGuestRsvp(event.id, linkedPlayer.id, "yes", owner.id))
      .rejects.toThrow(/linked/i);
  });
});

describe("getRsvpForGuest", () => {
  it("returns null when no row", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedEvent(owner.id);
    const guest = await prisma.player.create({
      data: { eventId: event.id, name: "Guest", order: 0 },
    });

    expect(await getRsvpForGuest(event.id, guest.id)).toBeNull();
  });

  it("returns the row when present", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedEvent(owner.id);
    const guest = await prisma.player.create({
      data: { eventId: event.id, name: "Guest", order: 0 },
    });
    await upsertGuestRsvp(event.id, guest.id, "yes", owner.id);

    const rsvp = await getRsvpForGuest(event.id, guest.id);
    expect(rsvp?.status).toBe("yes");
  });
});

describe("getRsvpSummary (with guests)", () => {
  it("counts yes/no/pending for user RSVPs AND guest player RSVPs", async () => {
    const owner = await seedUser({ name: "Owner" });
    const follower = await seedUser({ name: "Follower" });
    const event = await seedEvent(owner.id);

    await prisma.eventFollow.create({ data: { eventId: event.id, userId: follower.id } });

    const guest1 = await prisma.player.create({ data: { eventId: event.id, name: "G1", order: 0 } });
    const guest2 = await prisma.player.create({ data: { eventId: event.id, name: "G2", order: 1 } });

    // User RSVPs: 1 yes, 1 pending (owner)
    await upsertRsvp(event.id, follower.id, "yes");
    // Guest RSVPs: 1 yes, 1 no, owner pending
    await upsertGuestRsvp(event.id, guest1.id, "yes", owner.id);
    await upsertGuestRsvp(event.id, guest2.id, "no", owner.id);

    const summary = await getRsvpSummary(event.id);
    expect(summary.yes).toBe(2);          // follower + guest1
    expect(summary.no).toBe(1);           // guest2
    expect(summary.pending).toBe(1);      // owner (no userId-guests not in recipient set)
  });

  it("excludes soft-archived players from the summary (regression for 10-going/9-pending bug)", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedEvent(owner.id);

    // 10 active guests, 1 of them archived (would previously inflate yes+1 and miss pending-1)
    const active: string[] = [];
    for (let i = 0; i < 9; i++) {
      const g = await prisma.player.create({ data: { eventId: event.id, name: `A${i}`, order: i } });
      active.push(g.id);
    }
    const archived = await prisma.player.create({
      data: { eventId: event.id, name: "Archived", order: 99, archivedAt: new Date() },
    });

    // 9 active guests say yes, the archived player has a stale yes from before being archived
    for (const gid of active) await upsertGuestRsvp(event.id, gid, "yes", owner.id);
    await upsertGuestRsvp(event.id, archived.id, "yes", owner.id);

    const summary = await getRsvpSummary(event.id);
    expect(summary.yes).toBe(9);    // only the 9 active guests
    expect(summary.no).toBe(0);
    expect(summary.pending).toBe(1); // owner only
  });

  it("does not count an archived player's stale 'no' toward the no bucket either", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedEvent(owner.id);
    const archived = await prisma.player.create({
      data: { eventId: event.id, name: "Archived", order: 0, archivedAt: new Date() },
    });
    await upsertGuestRsvp(event.id, archived.id, "no", owner.id);

    const summary = await getRsvpSummary(event.id);
    expect(summary.no).toBe(0);
    expect(summary.yes).toBe(0);
    expect(summary.pending).toBe(1); // owner
  });
});

describe("rsvpCutoffSent idempotency", () => {
  it("starts false and toggles true after markRsvpCutoffSent", async () => {
    const event = await seedEvent(null);
    expect(await isRsvpCutoffSent(event.id)).toBe(false);
    await markRsvpCutoffSent(event.id);
    expect(await isRsvpCutoffSent(event.id)).toBe(true);
  });

  it("returns false for a non-existent event", async () => {
    expect(await isRsvpCutoffSent("does-not-exist")).toBe(false);
  });
});

describe("getEventsNeedingRsvpPing", () => {
  it("returns events with dateTime in (now+47h, now+49h] and rsvpCutoffSent=false", async () => {
    const owner = await seedUser();
    await seedEvent(owner.id, {
      id: "e-in",
      dateTime: new Date(Date.now() + 48 * 3600_000 + 60_000),
      rsvpCutoffSent: false,
    });
    await seedEvent(owner.id, {
      id: "e-out",
      dateTime: new Date(Date.now() + 72 * 3600_000),
      rsvpCutoffSent: false,
    });
    await seedEvent(owner.id, {
      id: "e-sent",
      dateTime: new Date(Date.now() + 48 * 3600_000 + 60_000),
      rsvpCutoffSent: true,
    });

    const ids = (await getEventsNeedingRsvpPing()).map((e) => e.id);
    expect(ids).toContain("e-in");
    expect(ids).not.toContain("e-out");
    expect(ids).not.toContain("e-sent");
  });
});

describe("getEventsNeedingRsvpSummary", () => {
  it("returns events at the 24h mark with rsvpCutoffSent=true", async () => {
    const owner = await seedUser();
    await seedEvent(owner.id, {
      id: "e-sum",
      dateTime: new Date(Date.now() + 24 * 3600_000 + 60_000),
      rsvpCutoffSent: true,
    });
    await seedEvent(owner.id, {
      id: "e-not-sent",
      dateTime: new Date(Date.now() + 24 * 3600_000 + 60_000),
      rsvpCutoffSent: false,
    });
    await seedEvent(owner.id, {
      id: "e-far",
      dateTime: new Date(Date.now() + 72 * 3600_000),
      rsvpCutoffSent: true,
    });
    const ids = (await getEventsNeedingRsvpSummary()).map((e) => e.id);
    expect(ids).toContain("e-sum");
    expect(ids).not.toContain("e-not-sent");
    expect(ids).not.toContain("e-far");
  });
});

describe("userHasPendingRsvp", () => {
  it("returns true when user has a null-status row on a future event", async () => {
    const user = await seedUser();
    const ev = await seedEvent(null, { dateTime: new Date(Date.now() + 86400_000) });
    await prisma.rsvp.create({ data: { userId: user.id, eventId: ev.id, status: null } });
    expect(await userHasPendingRsvp(user.id)).toBe(true);
  });

  it("returns false when no pending row", async () => {
    const user = await seedUser();
    expect(await userHasPendingRsvp(user.id)).toBe(false);
  });

  it("returns false for an answered (yes) row", async () => {
    const user = await seedUser();
    const ev = await seedEvent(null, { dateTime: new Date(Date.now() + 86400_000) });
    await prisma.rsvp.create({ data: { userId: user.id, eventId: ev.id, status: "yes", respondedAt: new Date() } });
    expect(await userHasPendingRsvp(user.id)).toBe(false);
  });

  it("returns false for a pending row on a past event", async () => {
    const user = await seedUser();
    const ev = await seedEvent(null, { dateTime: new Date(Date.now() - 86400_000) });
    await prisma.rsvp.create({ data: { userId: user.id, eventId: ev.id, status: null } });
    expect(await userHasPendingRsvp(user.id)).toBe(false);
  });
});

describe("recordAppOpen + countAppOpenDays", () => {
  it("counts distinct days in the rolling window", async () => {
    const user = await seedUser();
    const today = new Date();
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
    const tenDaysAgo = new Date(Date.now() - 10 * 86400_000);

    await recordAppOpen(user.id, today);
    await recordAppOpen(user.id, twoDaysAgo);
    await recordAppOpen(user.id, tenDaysAgo);
    // duplicate day → still 1
    await recordAppOpen(user.id, today);

    const count = await countAppOpenDays(user.id, APP_OPEN_LOOKBACK_DAYS);
    expect(count).toBe(2);
  });

  it("exposes the constants used by the re-prompt rule", () => {
    expect(APP_OPEN_LOOKBACK_DAYS).toBe(7);
    expect(APP_OPEN_THRESHOLD).toBe(3);
    expect(PUSH_PROMPT_COOLDOWN_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(FRESH_ACCOUNT_DAYS).toBe(7);
  });
});

describe("push prompt state machine", () => {
  it("defaults to 'default'", async () => {
    const user = await seedUser();
    expect(await getPushPromptState(user.id)).toBe("default");
  });

  it("returns 'default' for a non-existent user", async () => {
    expect(await getPushPromptState("does-not-exist")).toBe("default");
  });

  it("stores state transitions", async () => {
    const user = await seedUser();
    await setPushPromptState(user.id, "dismissed");
    expect(await getPushPromptState(user.id)).toBe("dismissed");
    await setPushPromptState(user.id, "granted");
    expect(await getPushPromptState(user.id)).toBe("granted");
  });

  it("setPushPromptState updates pushPromptLastDismissedAt on dismissed", async () => {
    const user = await seedUser();
    await setPushPromptState(user.id, "dismissed");
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    expect(fresh?.pushPromptLastDismissedAt).not.toBeNull();
  });

  it("shouldShowPushPrompt: granted → false", async () => {
    const user = await seedUser();
    await setPushPromptState(user.id, "granted");
    expect(await shouldShowPushPrompt(user.id, false)).toBe(false);
  });

  it("shouldShowPushPrompt: denied → false (terminal)", async () => {
    const user = await seedUser();
    await setPushPromptState(user.id, "denied");
    expect(await shouldShowPushPrompt(user.id, false)).toBe(false);
  });

  it("shouldShowPushPrompt: default + no opt-in data → true (30d floor not yet hit)", async () => {
    const user = await seedUser();
    expect(await shouldShowPushPrompt(user.id, false)).toBe(true);
  });

  it("shouldShowPushPrompt: dismissed within 30d, no app-open activity → false", async () => {
    const user = await seedUser();
    await setPushPromptState(user.id, "dismissed");
    expect(await shouldShowPushPrompt(user.id, false)).toBe(false);
  });

  it("shouldShowPushPrompt: dismissed, ≥3 app-open days, has pending RSVP → true (accelerator)", async () => {
    const user = await seedUser();
    const owner = await seedUser({ name: "Owner" });
    const e = await seedEvent(owner.id);
    await setPushPromptState(user.id, "dismissed");
    for (let i = 0; i < APP_OPEN_THRESHOLD; i++) {
      await recordAppOpen(user.id, new Date(Date.now() - i * 86400_000));
    }
    // pending RSVP = row exists with status=null OR no row. We'll insert null-status row.
    await prisma.rsvp.create({ data: { userId: user.id, eventId: e.id, status: null } });
    expect(await shouldShowPushPrompt(user.id, true)).toBe(true);
  });

  it("shouldShowPushPrompt: dismissed, ≥3 app-open days, NO pending RSVP → false (no accelerator)", async () => {
    const user = await seedUser();
    await setPushPromptState(user.id, "dismissed");
    for (let i = 0; i < APP_OPEN_THRESHOLD; i++) {
      await recordAppOpen(user.id, new Date(Date.now() - i * 86400_000));
    }
    expect(await shouldShowPushPrompt(user.id, false)).toBe(false);
  });

  it("shouldShowPushPrompt: dismissed, dismissal older than cooldown → true (14d floor unlocks)", async () => {
    const user = await seedUser();
    // Backdate the dismissal by 15 days (cooldown is 14d)
    const longAgo = new Date(Date.now() - 15 * 86400_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { pushPromptState: "dismissed", pushPromptLastDismissedAt: longAgo },
    });
    expect(await shouldShowPushPrompt(user.id, false)).toBe(true);
  });

  it("shouldShowPushPrompt: fresh account (≤7d) bypasses cooldown (#463 first-7d onboarding)", async () => {
    const user = await seedUser();
    // Dismissed 1 day ago — within cooldown — would normally be false
    const recent = new Date(Date.now() - 1 * 86400_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { pushPromptState: "dismissed", pushPromptLastDismissedAt: recent },
    });
    expect(await shouldShowPushPrompt(user.id, false)).toBe(false);

    // But if the account is ≤7 days old, bypass the cooldown
    const fresh = new Date(Date.now() - 3 * 86400_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { createdAt: fresh },
    });
    expect(await shouldShowPushPrompt(user.id, false)).toBe(true);
  });

  it("userAccountAgeDays returns fractional days since createdAt", async () => {
    const user = await seedUser();
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400_000);
    await prisma.user.update({ where: { id: user.id }, data: { createdAt: fiveDaysAgo } });
    const age = await userAccountAgeDays(user.id);
    expect(age).toBeGreaterThan(4.99);
    expect(age).toBeLessThan(5.01);
  });

  it("userAccountAgeDays returns Infinity for non-existent user", async () => {
    expect(await userAccountAgeDays("does-not-exist")).toBe(Number.POSITIVE_INFINITY);
  });
});
