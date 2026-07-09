/**
 * Tests for the Historical Settlement path (ADR 0019) and the bulk settle.
 * The settle path writes a `payment_received` WalletTransaction row with
 * `gameHistoryId` set; the read path nets it against the snapshot-derived
 * balance.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  settleHistoricalGame,
  settleAllHistoricalForPlayer,
} from "~/lib/payments.server";

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.monthlySubscription.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany({ where: { id: { startsWith: "ghost:" } } });
});

async function seedGoncaloEvent() {
  const event = await prisma.event.create({
    data: {
      title: "Ninjas",
      location: "Pitch",
      dateTime: new Date("2026-07-13T18:00:00.000Z"),
      timezone: "Europe/Lisbon",
      maxPlayers: 10,
      eventCost: {
        create: { totalAmount: 50, currency: "EUR" },
      },
    },
    include: { eventCost: true },
  });
  const ec = event.eventCost!;
  // Gonçalo is a ghost player (no userId)
  await prisma.player.create({ data: { name: "Gonçalo", eventId: event.id, order: 0 } });
  const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Gonçalo" } });
  const userId = `ghost:${ep.id}`;
  await prisma.user.create({ data: { id: userId, name: "Gonçalo", email: `ghost-${ep.id}@system.local`, emailVerified: false } });
  await prisma.eventPlayer.update({ where: { id: ep.id }, data: { userId } });

  // 2 historical games, both pending
  const games: Array<{ id: string; date: Date }> = [];
  for (let g = 0; g < 2; g++) {
    const date = new Date(`2026-06-${String(g + 1).padStart(2, "0")}T18:00:00Z`);
    const gh = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: date,
        status: "played",
        teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Gonçalo", order: 0 }] }]),
        paymentsSnapshot: JSON.stringify([{ playerName: "Gonçalo", amount: 5, status: "pending", method: null }]),
        editableUntil: new Date(date.getTime() + 7 * 86400_000),
      },
    });
    games.push({ id: gh.id, date });
  }
  // also write the per_game_share debit for each (matches the backfill)
  for (const g of games) {
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id,
        userId,
        amountCents: 500,
        currency: "EUR",
        direction: "debit",
        reason: "per_game_share",
        eventInstanceId: g.id,
        gameHistoryId: g.id,
        playerName: "Gonçalo",
        idempotencyKey: `backfill:perGameShare:${g.id}:Gonçalo`,
        createdAt: g.date,
      },
    });
  }
  return { event, ec, games, userId, goncaloEventPlayerId: ep.id };
}

describe("settleHistoricalGame (ADR 0019)", () => {
  it("writes a payment_received row idempotently", async () => {
    const { event, games, userId } = await seedGoncaloEvent();
    const gameId = games[0].id;

    const r1 = await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: gameId,
      playerName: "Gonçalo",
      markedById: userId,
    });
    expect(r1.written).toBe(true);
    expect(r1.walletTransactionId).toBeTruthy();

    const r2 = await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: gameId,
      playerName: "Gonçalo",
      markedById: userId,
    });
    expect(r2.written).toBe(false);
    expect(r2.reason).toBe("already-settled");

    const all = await prisma.walletTransaction.findMany({ where: { eventId: event.id, reason: "payment_received" } });
    expect(all).toHaveLength(1);
  });

  it("uses the snapshot's amount when no amountCents provided", async () => {
    const { event, games, userId } = await seedGoncaloEvent();
    const r = await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: games[0].id,
      playerName: "Gonçalo",
      markedById: userId,
    });
    expect(r.written).toBe(true);
    const row = await prisma.walletTransaction.findUnique({ where: { id: r.walletTransactionId! } });
    expect(row?.amountCents).toBe(500);
  });

  it("records the payer (defaults to the debtor) and the paidTo (defaults to the event owner)", async () => {
    const { event, games, userId, goncaloEventPlayerId } = await seedGoncaloEvent();
    const r = await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: games[0].id,
      playerName: "Gonçalo",
      markedById: userId,
    });
    const row = await prisma.walletTransaction.findUnique({ where: { id: r.walletTransactionId! } });
    // Payer defaults to the debtor (Gonçalo, the ghost user)
    expect(row?.payerUserId).toBe(`ghost:${goncaloEventPlayerId}`);
    // paidTo defaults to the event owner (no owner set in the test seed, so null)
    expect(row?.paidToUserId).toBeNull();
  });

  it("records the explicit payer + paidTo when provided", async () => {
    const { event, games, userId } = await seedGoncaloEvent();
    // Add a "friend" user who pays on Gonçalo's behalf, and set an owner
    // so the paidTo default has somewhere to point.
    const friend = await prisma.user.create({ data: { id: "friend-1", name: "Friend", email: "friend@test.com", emailVerified: false } });
    await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@test.com", emailVerified: false } });
    await prisma.event.update({ where: { id: event.id }, data: { ownerId: "owner-1" } });

    const r = await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: games[0].id,
      playerName: "Gonçalo",
      markedById: userId,
      payerUserId: friend.id,
      paidToUserId: "owner-1",
    });
    const row = await prisma.walletTransaction.findUnique({ where: { id: r.walletTransactionId! } });
    expect(row?.payerUserId).toBe(friend.id);
    expect(row?.paidToUserId).toBe("owner-1");
  });

  it("is idempotent on (gameHistoryId, playerName, payer, paidTo)", async () => {
    const { event, games, userId } = await seedGoncaloEvent();
    await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: games[0].id,
      playerName: "Gonçalo",
      markedById: userId,
    });
    const r2 = await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: games[0].id,
      playerName: "Gonçalo",
      markedById: userId,
    });
    expect(r2.written).toBe(false);
    expect(r2.reason).toBe("already-settled");
  });

  it("overrides the amount when amountCents is provided", async () => {
    const { event, games, userId } = await seedGoncaloEvent();
    const r = await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: games[0].id,
      playerName: "Gonçalo",
      markedById: userId,
      amountCents: 700,
    });
    const row = await prisma.walletTransaction.findUnique({ where: { id: r.walletTransactionId! } });
    expect(row?.amountCents).toBe(700);
  });

  it("returns no-event-player for a player that doesn't exist", async () => {
    const { event, games, userId } = await seedGoncaloEvent();
    const r = await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: games[0].id,
      playerName: "Ghost McGhostFace",
      markedById: userId,
    });
    expect(r.reason).toBe("no-event-player");
  });
});

describe("settleAllHistoricalForPlayer (bulk)", () => {
  it("settles every pending historical game for a player", async () => {
    const { event, userId } = await seedGoncaloEvent();
    const r = await settleAllHistoricalForPlayer({
      eventId: event.id,
      playerName: "Gonçalo",
      markedById: userId,
    });
    expect(r.settled).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.failed).toBe(0);

    const all = await prisma.walletTransaction.findMany({
      where: { eventId: event.id, reason: "payment_received" },
    });
    expect(all).toHaveLength(2);
  });

  it("is idempotent on re-run", async () => {
    const { event, userId } = await seedGoncaloEvent();
    await settleAllHistoricalForPlayer({ eventId: event.id, playerName: "Gonçalo", markedById: userId });
    const r2 = await settleAllHistoricalForPlayer({ eventId: event.id, playerName: "Gonçalo", markedById: userId });
    expect(r2.settled).toBe(0);
    expect(r2.skipped).toBe(2);
  });
});
