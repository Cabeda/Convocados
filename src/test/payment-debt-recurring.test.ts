/**
 * Regression #1767 — date the payment chase from the played Game, not the next
 * occurrence.
 *
 * A recurring reset moves Event.dateTime and currentGameId forward the moment a
 * game ends. Both the 3-stage nudge and the legacy payment email used those
 * fields, so from kickoff end the Game the group just played was invisible to
 * every chase: the payments page showed the debt, but no nudge or email fired.
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

function uid() {
  return `u-${Math.random().toString(36).slice(2, 8)}`;
}
function eid() {
  return `e-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedUser(name: string) {
  return prisma.user.create({
    data: { id: uid(), name, email: `${uid()}@t.com`, emailVerified: true },
  });
}

/**
 * A recurring Event after its occurrence reset: Event.dateTime and
 * currentGameId point at next week, while the played Game still holds debt.
 * This is the state the eager 5-minute reset leaves behind.
 */
async function seedAdvancedEvent(ownerId: string, endedHoursAgo: number) {
  const durationMinutes = 90;
  const gameEnd = new Date(Date.now() - endedHoursAgo * 60 * 60 * 1000);
  const playedDateTime = new Date(gameEnd.getTime() - durationMinutes * 60_000);
  const event = await prisma.event.create({
    data: {
      id: eid(),
      title: "Weekly Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 7 * 86400_000),
      durationMinutes,
      maxPlayers: 10,
      ownerId,
      isRecurring: true,
    },
  });
  const played = await prisma.game.create({
    data: { eventId: event.id, dateTime: playedDateTime, status: "played" },
  });
  const upcoming = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: upcoming.id } });
  return { event, played, upcoming };
}

async function addDebt(
  eventId: string,
  gameId: string,
  name: string,
  amount: number,
  status: string,
  userId: string | null,
) {
  const eventPlayer = await prisma.eventPlayer.create({ data: { eventId, name, userId } });
  return prisma.gamePayment.create({
    data: { gameId, eventPlayerId: eventPlayer.id, playerName: name, amount, status },
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

describe("payment chase after a recurring reset (#1767)", () => {
  it("sends stage 1 for the played occurrence even though the Event moved forward", async () => {
    const owner = await seedUser("Owner");
    const debtor = await seedUser("Debtor");
    const { event, played } = await seedAdvancedEvent(owner.id, 1);
    await addDebt(event.id, played.id, "Debtor", 5, "pending", debtor.id);

    const result = await processPaymentEscalation();

    expect(result.stage1Sent).toEqual([`${debtor.id}:${event.id}`]);
    expect(mockSendPush).toHaveBeenCalledWith(
      debtor.id,
      "Weekly Game",
      expect.stringContaining("5.00€"),
      expect.stringContaining("action=pay"),
    );
  });

  it("advances stage 2 on the played occurrence's schedule", async () => {
    const owner = await seedUser("Owner");
    const debtor = await seedUser("Debtor");
    const { event, played } = await seedAdvancedEvent(owner.id, 50);
    await addDebt(event.id, played.id, "Debtor", 5, "pending", debtor.id);
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 1, lastSentAt: new Date(Date.now() - 49 * 3600_000) },
    });

    const result = await processPaymentEscalation();

    expect(result.stage2Sent).toEqual([`${debtor.id}:${event.id}`]);
    expect(mockSendPush.mock.calls[0][2]).toContain("Still pending");
  });

  it("advances stage 3 on the played occurrence's schedule", async () => {
    const owner = await seedUser("Owner");
    const debtor = await seedUser("Debtor");
    const { event, played } = await seedAdvancedEvent(owner.id, 130);
    await addDebt(event.id, played.id, "Debtor", 5, "pending", debtor.id);
    await addDebt(event.id, played.id, "Paid1", 5, "paid", null);
    await addDebt(event.id, played.id, "Paid2", 5, "paid", null);
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 2 },
    });

    const result = await processPaymentEscalation();

    expect(result.stage3Sent).toEqual([`${debtor.id}:${event.id}`]);
    expect(mockSendPush.mock.calls[0][2]).toContain("2/3 players have paid");
  });

  it("sends the organizer alert on the played occurrence's schedule", async () => {
    const owner = await seedUser("Owner");
    const debtor = await seedUser("Debtor");
    const { event, played } = await seedAdvancedEvent(owner.id, 170);
    await addDebt(event.id, played.id, "Debtor", 5, "pending", debtor.id);
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 3 },
    });

    const result = await processPaymentEscalation();

    expect(result.organizerAlerts).toEqual([`${debtor.id}:${event.id}`]);
    expect(mockSendPush).toHaveBeenCalledWith(
      owner.id,
      "Weekly Game",
      expect.stringContaining("still haven't paid"),
      expect.stringContaining("action=confirm-payment"),
    );
  });

  it("payment email reads the played occurrence's GamePayment, not the next Game", async () => {
    const owner = await seedUser("Owner");
    const debtor = await seedUser("Debtor");
    const { event, played } = await seedAdvancedEvent(owner.id, 24);
    await addDebt(event.id, played.id, "Debtor", 5, "pending", debtor.id);

    const pending = await getPlayersWithPendingPayments();

    const match = pending.find((p) => p.eventId === event.id && p.userId === debtor.id);
    expect(match).toBeDefined();
    expect(match!.amount).toBe(5);
  });
});
