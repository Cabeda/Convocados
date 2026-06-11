import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { syncPaymentsForEvent } from "~/lib/payments.server";
import { getPlayersWithPendingPayments } from "~/lib/paymentReminders.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  await prisma.paymentReminderLog.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
});

describe("syncPaymentsForEvent — owner auto-paid", () => {
  it("marks owner's payment as paid on creation", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@test.com", emailVerified: true } });
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Test Game", dateTime: new Date(), ownerId: owner.id, maxPlayers: 10, location: "Test Field" },
    });
    await prisma.player.createMany({
      data: [
        { eventId: event.id, name: "Owner", userId: owner.id, order: 0 },
        { eventId: event.id, name: "Regular", userId: null, order: 1 },
      ],
    });
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });

    await syncPaymentsForEvent(event.id);

    const payments = await prisma.playerPayment.findMany({ where: { eventCost: { eventId: event.id } } });
    const ownerPayment = payments.find((p) => p.playerName === "Owner");
    const regularPayment = payments.find((p) => p.playerName === "Regular");

    expect(ownerPayment?.status).toBe("paid");
    expect(ownerPayment?.paidAt).toBeInstanceOf(Date);
    expect(regularPayment?.status).toBe("pending");
    expect(regularPayment?.paidAt).toBeNull();
  });

  it("does not override existing status on update (preserves manual changes)", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@test.com", emailVerified: true } });
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Test Game", dateTime: new Date(), ownerId: owner.id, maxPlayers: 10, location: "Test Field" },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "Regular", userId: null, order: 0 } });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    // Pre-create a payment with status "sent"
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "Regular", amount: 25, status: "sent" },
    });

    // Add a second player — triggers re-sync with new share
    await prisma.player.create({ data: { eventId: event.id, name: "New Player", userId: null, order: 1 } });
    await syncPaymentsForEvent(event.id);

    const payments = await prisma.playerPayment.findMany({ where: { eventCostId: cost.id } });
    const regular = payments.find((p) => p.playerName === "Regular");
    expect(regular?.status).toBe("sent"); // Preserved, not reset to pending
    expect(regular?.amount).toBe(25); // Amount updated to new share
  });
});

describe("getPlayersWithPendingPayments — timing", () => {
  it("excludes games that haven't ended yet (dateTime + duration in the future)", async () => {
    const user = await prisma.user.create({ data: { id: "u1", name: "José", email: "jose@test.com", emailVerified: true } });
    const futureDate = new Date(Date.now() + 3600_000); // 1 hour from now
    const event = await prisma.event.create({
      data: { id: "evt-future", title: "Future Game", dateTime: futureDate, durationMinutes: 60, maxPlayers: 10, location: "Test Field" },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "José", userId: user.id, order: 0 } });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "José", amount: 5, status: "pending" },
    });

    const results = await getPlayersWithPendingPayments();
    expect(results).toHaveLength(0);
  });

  it("includes games that have ended (dateTime + duration in the past)", async () => {
    const user = await prisma.user.create({ data: { id: "u1", name: "José", email: "jose@test.com", emailVerified: true } });
    const pastDate = new Date(Date.now() - 7200_000); // 2 hours ago
    const event = await prisma.event.create({
      data: { id: "evt-past", title: "Past Game", dateTime: pastDate, durationMinutes: 60, maxPlayers: 10, location: "Test Field" },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "José", userId: user.id, order: 0 } });
    const cost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: cost.id, playerName: "José", amount: 5, status: "pending" },
    });

    const results = await getPlayersWithPendingPayments();
    expect(results).toHaveLength(1);
    expect(results[0].playerName).toBe("José");
  });

  it("excludes the owner from pending payment reminders (auto-marked paid)", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@test.com", emailVerified: true } });
    const pastDate = new Date(Date.now() - 7200_000);
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Game", dateTime: pastDate, durationMinutes: 60, ownerId: owner.id, maxPlayers: 10, location: "Test Field" },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "Owner", userId: owner.id, order: 0 } });
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
    });

    // Sync creates the payment — owner should be auto-marked paid
    await syncPaymentsForEvent(event.id);

    const results = await getPlayersWithPendingPayments();
    expect(results).toHaveLength(0); // Owner is "paid", not "pending"
  });
});
