/**
 * Regression: payment notifications must not fire for archived events.
 *
 * Follow-up to #1141. Archiving an event cancels its reminder/post-game
 * notifications; payment nudges (escalation push + legacy email reminders)
 * must follow the same rule. The debt still lives in the ledger/payment roll —
 * archiving only silences delivery.
 */
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
  wantsPaymentReminderEmail: vi.fn().mockReturnValue(true),
}));

import { processPaymentEscalation } from "~/lib/paymentNudgeEscalation.server";
import { getPlayersWithPendingPayments } from "~/lib/paymentReminders.server";

function uid() { return `u-${Math.random().toString(36).slice(2, 8)}`; }
function eid() { return `e-${Math.random().toString(36).slice(2, 8)}`; }

async function seedUser(name: string) {
  return prisma.user.create({
    data: { id: uid(), name, email: `${uid()}@t.com`, emailVerified: true },
  });
}

/** Event that ended `hoursAgo` hours in the past, optionally archived. */
async function seedPastEvent(ownerId: string, hoursAgo: number, archived = false) {
  const durationMinutes = 90;
  const gameEnd = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const dateTime = new Date(gameEnd.getTime() - durationMinutes * 60_000);
  return prisma.event.create({
    data: {
      id: eid(),
      title: "Past Game",
      location: "Pitch",
      dateTime,
      durationMinutes,
      maxPlayers: 10,
      ownerId,
      archivedAt: archived ? new Date() : null,
    },
  });
}

/**
 * Debt fixture during the reader/writer split (5rhgs71k):
 * - GamePayment on the occurrence Game = what escalation readers consume
 * - PlayerPayment = what the legacy email reminder path still reads
 */
async function seedDebt(eventId: string, name: string, userId: string) {
  await prisma.player.create({
    data: { eventId, name, order: 0, userId },
  });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const game = await prisma.game.create({
    data: { eventId, dateTime: event.dateTime, status: "played" },
  });
  await prisma.event.update({ where: { id: eventId }, data: { currentGameId: game.id } });
  const eventPlayer = await prisma.eventPlayer.create({ data: { eventId, name, userId } });
  await prisma.gamePayment.create({
    data: { gameId: game.id, eventPlayerId: eventPlayer.id, playerName: name, amount: 5, status: "pending" },
  });
  const cost = await prisma.eventCost.create({
    data: { eventId, totalAmount: 10, currency: "EUR" },
  });
  await prisma.playerPayment.create({
    data: { eventCostId: cost.id, playerName: name, amount: 5, status: "pending" },
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

describe("processPaymentEscalation skips archived events", () => {
  it("does not nudge a debtor whose event is archived", async () => {
    const owner = await seedUser("Owner");
    const debtor = await seedUser("Debtor");
    const event = await seedPastEvent(owner.id, 1, true);
    await seedDebt(event.id, "Debtor", debtor.id);

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toHaveLength(0);
    expect(result.organizerAlerts).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("still nudges a debtor on a live event (control)", async () => {
    const owner = await seedUser("Owner");
    const debtor = await seedUser("Debtor");
    const event = await seedPastEvent(owner.id, 1, false);
    await seedDebt(event.id, "Debtor", debtor.id);

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toHaveLength(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      debtor.id,
      "Past Game",
      expect.stringContaining("€5.00"),
      expect.stringContaining("action=pay"),
    );
  });
});

describe("getPlayersWithPendingPayments skips archived events", () => {
  it("excludes pending payments on an archived event", async () => {
    const owner = await seedUser("Owner");
    const debtor = await seedUser("Debtor");
    const archived = await seedPastEvent(owner.id, 24, true);
    await seedDebt(archived.id, "Debtor", debtor.id);
    const live = await seedPastEvent(owner.id, 24, false);
    await seedDebt(live.id, "Debtor", debtor.id);

    const pending = await getPlayersWithPendingPayments();

    expect(pending.map((p) => p.eventId)).not.toContain(archived.id);
    expect(pending.map((p) => p.eventId)).toContain(live.id);
  });
});
