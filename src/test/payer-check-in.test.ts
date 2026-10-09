import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

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

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));
import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { processPayerCheckIns } from "~/lib/payerCheckIn.server";
import { POST as postMarkAllPaid } from "~/pages/api/events/[id]/payments/payer-check-in/mark-all-paid";
import { POST as postSnooze } from "~/pages/api/events/[id]/payments/payer-check-in/snooze";

function uid() { return `u-${Math.random().toString(36).slice(2, 8)}`; }
function eid() { return `e-${Math.random().toString(36).slice(2, 8)}`; }

async function seedUser(overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { id: uid(), name: "Player", email: `${uid()}@t.com`, emailVerified: true, ...overrides },
  });
}

/** Create an event that ended `hoursAgo` hours in the past, with a cost configured */
async function seedPastEvent(ownerId: string | null, hoursAgo: number) {
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
      // Settlement dual-writes the ledger, which requires a cost row.
      eventCost: { create: { totalAmount: 20, currency: "EUR", monthlyGamesCovered: 5 } },
    },
  });
}

interface SeedGameOpts {
  payerUserId?: string | null;
  payerExternalName?: string | null;
  status?: string;
}

/**
 * Occurrence Game with a payer, plus players/payments.
 * Returns { game, payments }.
 */
async function seedGameWithPayments(
  eventId: string,
  rows: Array<{ name: string; amount: number; status: string; userId?: string | null }>,
  opts: SeedGameOpts = {},
) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const game = await prisma.game.create({
    data: {
      eventId,
      dateTime: event.dateTime,
      status: opts.status ?? "played",
      payerExternalName: opts.payerExternalName ?? null,
    },
  });
  await prisma.event.update({ where: { id: eventId }, data: { currentGameId: game.id } });

  if (opts.payerUserId !== null) {
    const payer = await prisma.eventPlayer.upsert({
      where: { eventId_name: { eventId, name: "Payer" } },
      create: { eventId, name: "Payer", userId: opts.payerUserId ?? null },
      update: { userId: opts.payerUserId ?? null },
    });
    await prisma.game.update({ where: { id: game.id }, data: { payerEventPlayerId: payer.id } });
  }

  const payments = [];
  for (const row of rows) {
    const ep = await prisma.eventPlayer.upsert({
      where: { eventId_name: { eventId, name: row.name } },
      create: { eventId, name: row.name, userId: row.userId ?? null },
      update: {},
    });
    payments.push(await prisma.gamePayment.upsert({
      where: { gameId_eventPlayerId: { gameId: game.id, eventPlayerId: ep.id } },
      create: { gameId: game.id, eventPlayerId: ep.id, playerName: row.name, amount: row.amount, status: row.status },
      update: { amount: row.amount, status: row.status },
    }));
  }
  return { game, payments };
}

function postCtx(params: Record<string, string>, body: unknown) {
  return {
    request: new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  } as any;
}

beforeEach(async () => {
  mockSendPush.mockClear();
  mockWantsReminder.mockReturnValue(true);
  mockGetSession.mockReset();
  await resetApiRateLimitStore();
  await prisma.walletTransaction.deleteMany();
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

describe("processPayerCheckIns", () => {
  it("asks the payer whether everyone paid 24h after the game ends", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    const { game } = await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
      { name: "Paid", amount: 5, status: "paid", userId: null },
    ], { payerUserId: payer.id });

    const result = await processPayerCheckIns();

    expect(result.asked).toEqual([`${event.id}:${game.id}`]);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      payer.id,
      "Past Game",
      expect.stringContaining("everyone paid"),
      `/events/${event.id}`,
      { type: "payment_payer_check_in", gameId: game.id },
    );
  });

  it("does not ask when everyone has already paid", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 48);
    await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "paid", userId: null },
    ], { payerUserId: payer.id });

    const result = await processPayerCheckIns();

    expect(result.asked).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("does not ask within 24h of the game ending", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 23);
    await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });

    const result = await processPayerCheckIns();

    expect(result.asked).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("asks exactly once across repeated cron ticks", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });

    const first = await processPayerCheckIns();
    const second = await processPayerCheckIns();
    const third = await processPayerCheckIns();

    expect(first.asked).toHaveLength(1);
    expect(second.asked).toHaveLength(0);
    expect(third.asked).toHaveLength(0);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
  });

  it("respects the snooze marker and asks again 24h later", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    const { game } = await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });

    await processPayerCheckIns();
    expect(mockSendPush).toHaveBeenCalledTimes(1);

    // Payer taps "ask again in 24h" — suppress until then.
    await prisma.game.update({
      where: { id: game.id },
      data: { payerCheckInSnoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    const snoozed = await processPayerCheckIns();
    expect(snoozed.asked).toHaveLength(0);
    expect(mockSendPush).toHaveBeenCalledTimes(1);

    // 24h later the snooze window has elapsed — ask once more.
    await prisma.game.update({
      where: { id: game.id },
      data: { payerCheckInSnoozedUntil: new Date(Date.now() - 60 * 1000) },
    });
    const reasked = await processPayerCheckIns();
    expect(reasked.asked).toHaveLength(1);
    expect(mockSendPush).toHaveBeenCalledTimes(2);

    // And stays quiet afterwards.
    const after = await processPayerCheckIns();
    expect(after.asked).toHaveLength(0);
    expect(mockSendPush).toHaveBeenCalledTimes(2);
  });

  it("skips payers who opted out of payment reminder push", async () => {
    mockWantsReminder.mockReturnValue(false);
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });

    const result = await processPayerCheckIns();

    expect(result.asked).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("skips games whose payer has no linked user account", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    // Payer EventPlayer exists but is not linked to a user.
    await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: null });

    const result = await processPayerCheckIns();

    expect(result.asked).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("stays quiet when the game is cancelled", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id, status: "cancelled" });

    const result = await processPayerCheckIns();

    expect(result.asked).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("logs and continues when the push send fails", async () => {
    mockSendPush.mockRejectedValueOnce(new Error("FCM down"));
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });

    const result = await processPayerCheckIns();

    expect(result.asked).toHaveLength(0);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/events/[id]/payments/payer-check-in/mark-all-paid", () => {
  async function seedPayerGame(hoursAgo = 25) {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, hoursAgo);
    const { game, payments } = await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
      { name: "Other", amount: 5, status: "sent", userId: null },
    ], { payerUserId: payer.id });
    return { payer, event, game, payments };
  }

  it("marks every share paid when the payer confirms", async () => {
    const { payer, event, game } = await seedPayerGame();
    mockGetSession.mockResolvedValue({ user: { id: payer.id } } as any);

    const res = await postMarkAllPaid(postCtx({ id: event.id }, { gameId: game.id }));

    expect(res.status).toBe(200);
    const rows = await prisma.gamePayment.findMany({ where: { gameId: game.id } });
    expect(rows.every((r) => r.status === "paid")).toBe(true);
    expect(rows.every((r) => r.markedBy === payer.id)).toBe(true);
  });

  it("rejects callers who are not the payer", async () => {
    const { event, game } = await seedPayerGame();
    const stranger = await seedUser({ name: "Stranger" });
    mockGetSession.mockResolvedValue({ user: { id: stranger.id } } as any);

    const res = await postMarkAllPaid(postCtx({ id: event.id }, { gameId: game.id }));

    expect(res.status).toBe(403);
    const rows = await prisma.gamePayment.findMany({ where: { gameId: game.id } });
    expect(rows.some((r) => r.status !== "paid")).toBe(true);
  });

  it("requires authentication", async () => {
    const { event, game } = await seedPayerGame();
    mockGetSession.mockResolvedValue(null);

    const res = await postMarkAllPaid(postCtx({ id: event.id }, { gameId: game.id }));

    expect(res.status).toBe(401);
  });

  it("rejects a missing gameId", async () => {
    const { payer, event } = await seedPayerGame();
    mockGetSession.mockResolvedValue({ user: { id: payer.id } } as any);

    const res = await postMarkAllPaid(postCtx({ id: event.id }, {}));

    expect(res.status).toBe(400);
  });

  it("rejects a gameId from another event", async () => {
    const { payer, event } = await seedPayerGame();
    const other = await seedPastEvent(payer.id, 30);
    const { game: otherGame } = await seedGameWithPayments(other.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });
    mockGetSession.mockResolvedValue({ user: { id: payer.id } } as any);

    const res = await postMarkAllPaid(postCtx({ id: event.id }, { gameId: otherGame.id }));

    expect(res.status).toBe(404);
  });

  it("reports a ledger failure instead of crashing", async () => {
    // Settlement dual-writes the ledger, which needs the event's cost row.
    // A game whose cost config was removed must surface as a 400, not a 500.
    const payer = await seedUser({ name: "Payer" });
    const event = await prisma.event.create({
      data: {
        title: "No Cost Game",
        location: "Pitch",
        dateTime: new Date(Date.now() - 25 * 60 * 60 * 1000),
        durationMinutes: 90,
        maxPlayers: 10,
        ownerId: payer.id,
      },
    });
    const { game } = await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });
    mockGetSession.mockResolvedValue({ user: { id: payer.id } } as any);

    const res = await postMarkAllPaid(postCtx({ id: event.id }, { gameId: game.id }));

    expect(res.status).toBe(400);
    const rows = await prisma.gamePayment.findMany({ where: { gameId: game.id } });
    expect(rows.some((r) => r.status !== "paid")).toBe(true);
  });
});

describe("POST /api/events/[id]/payments/payer-check-in/snooze", () => {
  it("snoozes the check-in for 24h", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    const { game } = await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });
    mockGetSession.mockResolvedValue({ user: { id: payer.id } } as any);

    const before = Date.now();
    const res = await postSnooze(postCtx({ id: event.id }, { gameId: game.id }));

    expect(res.status).toBe(200);
    const updated = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(updated.payerCheckInSnoozedUntil).not.toBeNull();
    const snoozedMs = updated.payerCheckInSnoozedUntil!.getTime() - before;
    // Exactly 24h ahead, plus however long the request itself took.
    expect(snoozedMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(snoozedMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 10_000);
  });

  it("rejects callers who are not the payer", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    const { game } = await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });
    const stranger = await seedUser({ name: "Stranger" });
    mockGetSession.mockResolvedValue({ user: { id: stranger.id } } as any);

    const res = await postSnooze(postCtx({ id: event.id }, { gameId: game.id }));

    expect(res.status).toBe(403);
    const unchanged = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(unchanged.payerCheckInSnoozedUntil).toBeNull();
  });

  it("requires authentication", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    const { game } = await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });
    mockGetSession.mockResolvedValue(null);

    const res = await postSnooze(postCtx({ id: event.id }, { gameId: game.id }));

    expect(res.status).toBe(401);
  });

  it("rejects a gameId from another event", async () => {
    const payer = await seedUser({ name: "Payer" });
    const event = await seedPastEvent(payer.id, 25);
    await seedGameWithPayments(event.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });
    const other = await seedPastEvent(payer.id, 30);
    const { game: otherGame } = await seedGameWithPayments(other.id, [
      { name: "Debtor", amount: 5, status: "pending", userId: null },
    ], { payerUserId: payer.id });
    mockGetSession.mockResolvedValue({ user: { id: payer.id } } as any);

    const res = await postSnooze(postCtx({ id: event.id }, { gameId: otherGame.id }));

    expect(res.status).toBe(404);
  });
});
