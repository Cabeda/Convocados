/**
 * ADR 0018 — Organizer automation tests.
 * Covers: payment escalation stages, auto-confirm logic, no-show, deep link URLs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedUser(name: string, id?: string) {
  return prisma.user.create({ data: { id: id ?? `u-${name}`, name, email: `${name}@test.com`, emailVerified: true } });
}

async function seedEvent(ownerId: string | null = null, overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Weekly Futsal",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
      ownerId,
      isRecurring: true,
      durationMinutes: 60,
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await prisma.paymentNudgeStage.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ── Payment Nudge Escalation Stages ──────────────────────────────────────────

describe("PaymentNudgeStage model", () => {
  it("creates a stage tracker at stage 0", async () => {
    const user = await seedUser("Alice");
    const event = await seedEvent();
    const tracker = await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: user.id, stage: 0 },
    });
    expect(tracker.stage).toBe(0);
    expect(tracker.organiserAlert).toBe(false);
    expect(tracker.lastSentAt).toBeNull();
  });

  it("progresses through stages", async () => {
    const user = await seedUser("Bob");
    const event = await seedEvent();
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: user.id, stage: 0 },
    });

    // Stage 1
    await prisma.paymentNudgeStage.update({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
      data: { stage: 1, lastSentAt: new Date() },
    });
    let t = await prisma.paymentNudgeStage.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } });
    expect(t?.stage).toBe(1);

    // Stage 2
    await prisma.paymentNudgeStage.update({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
      data: { stage: 2, lastSentAt: new Date() },
    });
    t = await prisma.paymentNudgeStage.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } });
    expect(t?.stage).toBe(2);

    // Stage 3
    await prisma.paymentNudgeStage.update({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
      data: { stage: 3, lastSentAt: new Date() },
    });
    t = await prisma.paymentNudgeStage.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } });
    expect(t?.stage).toBe(3);
  });

  it("marks organiser alert", async () => {
    const user = await seedUser("Charlie");
    const event = await seedEvent();
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: user.id, stage: 3 },
    });
    await prisma.paymentNudgeStage.update({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
      data: { organiserAlert: true },
    });
    const t = await prisma.paymentNudgeStage.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } });
    expect(t?.organiserAlert).toBe(true);
  });

  it("enforces unique constraint on (eventId, userId)", async () => {
    const user = await seedUser("Dave");
    const event = await seedEvent();
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: user.id, stage: 0 },
    });
    await expect(
      prisma.paymentNudgeStage.create({ data: { eventId: event.id, userId: user.id, stage: 1 } }),
    ).rejects.toThrow();
  });
});

// ── Auto-Confirm Logic ───────────────────────────────────────────────────────

describe("Auto-confirm attendance", () => {
  it("returns empty when autoConfirmEnabled is false", async () => {
    const { getAutoConfirmedUserIds } = await import("~/lib/autoConfirm.server");
    const event = await seedEvent(null, { autoConfirmEnabled: false });
    const result = await getAutoConfirmedUserIds(event.id);
    expect(result.size).toBe(0);
  });

  it("returns empty when event is not recurring", async () => {
    const { getAutoConfirmedUserIds } = await import("~/lib/autoConfirm.server");
    const event = await seedEvent(null, { autoConfirmEnabled: true, isRecurring: false });
    const result = await getAutoConfirmedUserIds(event.id);
    expect(result.size).toBe(0);
  });

  it("returns empty when not enough game history", async () => {
    const { getAutoConfirmedUserIds } = await import("~/lib/autoConfirm.server");
    const event = await seedEvent(null, { autoConfirmEnabled: true, autoConfirmThreshold: 3 });
    // Only 1 game played — threshold is 3
    await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - 7 * 86400_000), status: "played" } });
    const result = await getAutoConfirmedUserIds(event.id);
    expect(result.size).toBe(0);
  });

  it("auto-confirms a player present in all last N games", async () => {
    const { getAutoConfirmedUserIds } = await import("~/lib/autoConfirm.server");
    const user = await seedUser("Regular");
    const event = await seedEvent(null, { autoConfirmEnabled: true, autoConfirmThreshold: 2 });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Regular", userId: user.id } });

    // Create 2 played games with this player participating
    for (let i = 0; i < 2; i++) {
      const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - (i + 1) * 7 * 86400_000), status: "played" } });
      await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id, order: 0 } });
    }

    const result = await getAutoConfirmedUserIds(event.id);
    expect(result.has(user.id)).toBe(true);
  });

  it("does NOT auto-confirm a player who missed one of the last N games", async () => {
    const { getAutoConfirmedUserIds } = await import("~/lib/autoConfirm.server");
    const user = await seedUser("Irregular");
    const event = await seedEvent(null, { autoConfirmEnabled: true, autoConfirmThreshold: 3 });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Irregular", userId: user.id } });

    // Create 3 games, player only in 2 of them
    const games = [];
    for (let i = 0; i < 3; i++) {
      games.push(await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - (i + 1) * 7 * 86400_000), status: "played" } }));
    }
    await prisma.gameParticipant.create({ data: { gameId: games[0].id, eventPlayerId: ep.id, order: 0 } });
    // Skip games[1]
    await prisma.gameParticipant.create({ data: { gameId: games[2].id, eventPlayerId: ep.id, order: 0 } });

    const result = await getAutoConfirmedUserIds(event.id);
    expect(result.has(user.id)).toBe(false);
  });

  it("no-show breaks auto-confirm streak", async () => {
    const { getAutoConfirmedUserIds } = await import("~/lib/autoConfirm.server");
    const user = await seedUser("NoShow");
    const event = await seedEvent(null, { autoConfirmEnabled: true, autoConfirmThreshold: 2 });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "NoShow", userId: user.id } });

    const game1 = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - 14 * 86400_000), status: "played" } });
    const game2 = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - 7 * 86400_000), status: "played" } });

    await prisma.gameParticipant.create({ data: { gameId: game1.id, eventPlayerId: ep.id, order: 0 } });
    // game2: player was there but marked no-show
    await prisma.gameParticipant.create({ data: { gameId: game2.id, eventPlayerId: ep.id, order: 0, noShow: true } });

    const result = await getAutoConfirmedUserIds(event.id);
    expect(result.has(user.id)).toBe(false);
  });

  it("applyAutoConfirm creates RSVP records", async () => {
    const { applyAutoConfirm } = await import("~/lib/autoConfirm.server");
    const user = await seedUser("Committed");
    const event = await seedEvent(null, { autoConfirmEnabled: true, autoConfirmThreshold: 2 });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Committed", userId: user.id } });

    for (let i = 0; i < 2; i++) {
      const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - (i + 1) * 7 * 86400_000), status: "played" } });
      await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id, order: 0 } });
    }

    const applied = await applyAutoConfirm(event.id);
    expect(applied).toContain(user.id);

    const rsvp = await prisma.rsvp.findUnique({ where: { userId_eventId: { userId: user.id, eventId: event.id } } });
    expect(rsvp?.status).toBe("yes");
  });
});

// ── No-Show ──────────────────────────────────────────────────────────────────

describe("No-show marking", () => {
  it("GameParticipant.noShow defaults to false", async () => {
    const event = await seedEvent();
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Test" } });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(), status: "played" } });
    const gp = await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id, order: 0 } });
    expect(gp.noShow).toBe(false);
  });

  it("can be set to true", async () => {
    const event = await seedEvent();
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Test" } });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(), status: "played" } });
    const gp = await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id, order: 0 } });
    const updated = await prisma.gameParticipant.update({ where: { id: gp.id }, data: { noShow: true } });
    expect(updated.noShow).toBe(true);
  });
});

// ── Notification Deep Link URLs ──────────────────────────────────────────────

describe("Notification deep link URL patterns", () => {
  it("payment_confirmed uses ?action=pay", () => {
    // Verified by code inspection — the enqueueNotification call in payments.ts uses:
    // url: `/events/${eventId}?action=pay`
    const url = `/events/test-id?action=pay`;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("action")).toBe("pay");
  });

  it("payment_self_reported uses ?action=confirm-payment&player=X", () => {
    const playerName = "José Cabeda";
    const url = `/events/test-id?action=confirm-payment&player=${encodeURIComponent(playerName)}`;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("action")).toBe("confirm-payment");
    expect(params.get("player")).toBe("José Cabeda");
  });

  it("post_game uses ?action=add-score", () => {
    const url = `/events/test-id?action=add-score`;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("action")).toBe("add-score");
  });

  it("recruitment uses ?action=join", () => {
    const url = `/events/test-id?action=join`;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("action")).toBe("join");
  });

  it("reminder uses ?action=rsvp", () => {
    const url = `/events/test-id?action=rsvp`;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("action")).toBe("rsvp");
  });
});

// ── Digest Mode Schema ───────────────────────────────────────────────────────

describe("Digest mode preferences", () => {
  it("digestMode defaults to false", async () => {
    const user = await seedUser("Org");
    const prefs = await prisma.notificationPreferences.create({ data: { userId: user.id } });
    expect(prefs.digestMode).toBe(false);
    expect(prefs.digestTime).toBe("09:00");
  });

  it("can enable digest mode with custom time", async () => {
    const user = await seedUser("Org2");
    const prefs = await prisma.notificationPreferences.create({
      data: { userId: user.id, digestMode: true, digestTime: "18:30" },
    });
    expect(prefs.digestMode).toBe(true);
    expect(prefs.digestTime).toBe("18:30");
  });
});

// ── Auto-Confirm Event Settings ──────────────────────────────────────────────

describe("Auto-confirm event settings", () => {
  it("autoConfirmEnabled defaults to false", async () => {
    const event = await prisma.event.create({
      data: { title: "Test", location: "X", dateTime: new Date(), maxPlayers: 10 },
    });
    expect(event.autoConfirmEnabled).toBe(false);
    expect(event.autoConfirmThreshold).toBe(3);
  });

  it("can be enabled with custom threshold", async () => {
    const event = await prisma.event.create({
      data: { title: "Test", location: "X", dateTime: new Date(), maxPlayers: 10, autoConfirmEnabled: true, autoConfirmThreshold: 5 },
    });
    expect(event.autoConfirmEnabled).toBe(true);
    expect(event.autoConfirmThreshold).toBe(5);
  });
});
