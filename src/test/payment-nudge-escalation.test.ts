import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const mockSendPush = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/push.server", () => ({ sendPushToUser: (...args: unknown[]) => mockSendPush(...args) }));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockGetPrefs = vi.fn().mockResolvedValue({ pushEnabled: true, paymentReminderPush: true });
const mockWantsReminder = vi.fn().mockReturnValue(true);
vi.mock("~/lib/notificationPrefs.server", () => ({
  getNotificationPrefs: (...args: unknown[]) => mockGetPrefs(...args),
  wantsPaymentReminderPush: (...args: unknown[]) => mockWantsReminder(...args),
}));

import { processPaymentEscalation } from "~/lib/paymentNudgeEscalation.server";

function uid() { return `u-${Math.random().toString(36).slice(2, 8)}`; }
function eid() { return `e-${Math.random().toString(36).slice(2, 8)}`; }

async function seedUser(overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { id: uid(), name: "Player", email: `${uid()}@t.com`, emailVerified: true, ...overrides },
  });
}

/** Create an event that ended `hoursAgo` hours in the past */
async function seedPastEvent(ownerId: string | null, hoursAgo: number) {
  const durationMinutes = 90;
  // gameEnd = dateTime + durationMinutes. We want gameEnd to be `hoursAgo` in the past.
  const gameEnd = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const dateTime = new Date(gameEnd.getTime() - durationMinutes * 60_000);
  return prisma.event.create({
    data: { id: eid(), title: "Past Game", location: "Pitch", dateTime, durationMinutes, maxPlayers: 10, ownerId },
  });
}

/**
 * Occurrence Game + EventPlayer + GamePayment (ADR 0016 debt source).
 * Returns the GamePayment row.
 */
async function seedOwedPayment(
  eventId: string,
  name: string,
  amount: number,
  status: string,
  userId: string | null,
) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  let game = await prisma.game.findFirst({ where: { eventId } });
  if (!game) {
    game = await prisma.game.create({
      data: { eventId, dateTime: event.dateTime, status: "played" },
    });
    await prisma.event.update({ where: { id: eventId }, data: { currentGameId: game.id } });
  }
  const eventPlayer = await prisma.eventPlayer.upsert({
    where: { eventId_name: { eventId, name } },
    create: { eventId, name, userId },
    update: userId ? { userId } : {},
  });
  return prisma.gamePayment.upsert({
    where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: eventPlayer.id } },
    create: { gameId: game.id, eventPlayerId: eventPlayer.id, playerName: name, amount, status },
    update: { amount, status },
  });
}

beforeEach(async () => {
  mockSendPush.mockClear();
  mockWantsReminder.mockReturnValue(true);
  await prisma.paymentNudgeStage.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("processPaymentEscalation", () => {
  it("returns empty result when no pending payments exist", async () => {
    const result = await processPaymentEscalation();
    expect(result.stage1Sent).toHaveLength(0);
    expect(result.stage2Sent).toHaveLength(0);
    expect(result.stage3Sent).toHaveLength(0);
    expect(result.organizerAlerts).toHaveLength(0);
  });

  it("sends stage 1 nudge immediately after game ends", async () => {
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 1); // ended 1h ago
    await seedOwedPayment(event.id, "Debtor", 5, "pending", debtor.id);

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toHaveLength(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      debtor.id,
      "Past Game",
      expect.stringContaining("€5.00"),
      expect.stringContaining("action=pay"),
    );
  });

  it("sends stage 2 follow-up after 48h", async () => {
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 50); // ended 50h ago
    await seedOwedPayment(event.id, "Debtor", 5, "pending", debtor.id);
    // Already at stage 1
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 1, lastSentAt: new Date(Date.now() - 49 * 3600_000) },
    });

    const result = await processPaymentEscalation();

    expect(result.stage2Sent).toHaveLength(1);
    expect(mockSendPush.mock.calls[0][2]).toContain("Still pending");
  });

  it("sends stage 3 social proof after 5 days", async () => {
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 130); // ended 130h ago (>5 days)
    await seedOwedPayment(event.id, "Debtor", 5, "pending", debtor.id);
    await seedOwedPayment(event.id, "Paid1", 5, "paid", null);
    await seedOwedPayment(event.id, "Paid2", 5, "paid", null);
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 2 },
    });

    const result = await processPaymentEscalation();

    expect(result.stage3Sent).toHaveLength(1);
    expect(mockSendPush.mock.calls[0][2]).toContain("2/3 players have paid");
  });

  it("sends organizer alert after 7 days and stops nudging debtor", async () => {
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 170); // ended 170h ago (>7 days)
    await seedOwedPayment(event.id, "Debtor", 5, "pending", debtor.id);
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 3 },
    });

    const result = await processPaymentEscalation();

    expect(result.organizerAlerts).toHaveLength(1);
    // Organizer gets notified
    expect(mockSendPush).toHaveBeenCalledWith(
      owner.id,
      "Past Game",
      expect.stringContaining("still haven't paid"),
      expect.stringContaining("action=confirm-payment"),
    );
  });

  it("skips players who opted out of payment reminder push", async () => {
    mockWantsReminder.mockReturnValue(false);
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 1);
    await seedOwedPayment(event.id, "Debtor", 5, "pending", debtor.id);

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("skips players not linked to a user account", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedPastEvent(owner.id, 1);
    // EventPlayer without userId
    await seedOwedPayment(event.id, "Guest", 5, "pending", null);

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("does not re-nudge after organiser alert is set", async () => {
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 200);
    await seedOwedPayment(event.id, "Debtor", 5, "pending", debtor.id);
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 3, organiserAlert: true },
    });

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toHaveLength(0);
    expect(result.stage2Sent).toHaveLength(0);
    expect(result.stage3Sent).toHaveLength(0);
    expect(result.organizerAlerts).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("sends stage 1 exactly once across repeated cron ticks", async () => {
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 1); // ended 1h ago
    await seedOwedPayment(event.id, "Debtor", 5, "pending", debtor.id);

    // Simulate 3 consecutive cron ticks: the nudge must fire on tick 1 only.
    await processPaymentEscalation();

    // Dedup state survives the tick (cleanup must not wipe active trackers).
    const trackers = await prisma.paymentNudgeStage.findMany({ where: { eventId: event.id } });
    expect(trackers.map((t) => t.stage)).toEqual([1]);

    await processPaymentEscalation();
    await processPaymentEscalation();

    expect(mockSendPush.mock.calls.length).toBe(1);
  });

  it("clears the tracker once the debt is settled", async () => {
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 1);
    const payment = await seedOwedPayment(event.id, "Debtor", 5, "pending", debtor.id);

    await processPaymentEscalation();
    expect(mockSendPush.mock.calls.length).toBe(1);

    // Debtor pays: next tick sends nothing and drops the stale tracker.
    await prisma.gamePayment.update({ where: { id: payment.id }, data: { status: "paid" } });
    mockSendPush.mockClear();
    await processPaymentEscalation();

    expect(mockSendPush).not.toHaveBeenCalled();
    const trackers = await prisma.paymentNudgeStage.findMany({ where: { eventId: event.id } });
    expect(trackers).toHaveLength(0);
  });
});
