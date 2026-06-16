import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  upsertRsvp,
  getRsvpForUser,
  getRsvpSummary,
  getRsvpRecipients,
  markRsvpCutoffSent,
  isRsvpCutoffSent,
  getEventsNeedingRsvpPing,
  getEventsNeedingRsvpSummary,
  userHasPendingRsvp,
  recordAppOpen,
  countAppOpenDays,
  setPushPromptState,
  getPushPromptState,
  shouldShowPushPrompt,
  PUSH_PROMPT_COOLDOWN_MS,
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
  return prisma.user.create({
    data: {
      id: `u-${Math.random().toString(36).slice(2, 8)}`,
      name: "Alice",
      email: `a-${Math.random().toString(36).slice(2, 8)}@t.com`,
      emailVerified: true,
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
});

describe("rsvpCutoffSent idempotency", () => {
  it("starts false and toggles true after markRsvpCutoffSent", async () => {
    const event = await seedEvent(null);
    expect(await isRsvpCutoffSent(event.id)).toBe(false);
    await markRsvpCutoffSent(event.id);
    expect(await isRsvpCutoffSent(event.id)).toBe(true);
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
    expect(PUSH_PROMPT_COOLDOWN_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("push prompt state machine", () => {
  it("defaults to 'default'", async () => {
    const user = await seedUser();
    expect(await getPushPromptState(user.id)).toBe("default");
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
});
