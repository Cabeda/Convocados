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

beforeEach(async () => {
  mockSendPush.mockClear();
  mockWantsReminder.mockReturnValue(true);
  await prisma.paymentNudgeStage.deleteMany();
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

    await prisma.player.create({
      data: { eventId: event.id, name: "Debtor", order: 0, userId: debtor.id },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 10 },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Debtor", amount: 5, status: "pending" },
    });

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

    await prisma.player.create({
      data: { eventId: event.id, name: "Debtor", order: 0, userId: debtor.id },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 10 },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Debtor", amount: 5, status: "pending" },
    });
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

    await prisma.player.create({
      data: { eventId: event.id, name: "Debtor", order: 0, userId: debtor.id },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50 },
    });
    await prisma.playerPayment.createMany({
      data: [
        { eventCostId: cost.id, playerName: "Debtor", amount: 5, status: "pending" },
        { eventCostId: cost.id, playerName: "Paid1", amount: 5, status: "paid" },
        { eventCostId: cost.id, playerName: "Paid2", amount: 5, status: "paid" },
      ],
    });
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

    await prisma.player.create({
      data: { eventId: event.id, name: "Debtor", order: 0, userId: debtor.id },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 10 },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Debtor", amount: 5, status: "pending" },
    });
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

    await prisma.player.create({
      data: { eventId: event.id, name: "Debtor", order: 0, userId: debtor.id },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 10 },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Debtor", amount: 5, status: "pending" },
    });

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("skips players not linked to a user account", async () => {
    const owner = await seedUser({ name: "Owner" });
    const event = await seedPastEvent(owner.id, 1);

    // Player without userId
    await prisma.player.create({
      data: { eventId: event.id, name: "Guest", order: 0 },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 10 },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Guest", amount: 5, status: "pending" },
    });

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("does not re-nudge after organiser alert is set", async () => {
    const owner = await seedUser({ name: "Owner" });
    const debtor = await seedUser({ name: "Debtor" });
    const event = await seedPastEvent(owner.id, 200);

    await prisma.player.create({
      data: { eventId: event.id, name: "Debtor", order: 0, userId: debtor.id },
    });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 10 },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Debtor", amount: 5, status: "pending" },
    });
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
});
