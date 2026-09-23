import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { syncGamePayments, settleShare } from "~/lib/settlement.server";
import { getOutstandingBalance } from "~/lib/balance.server";

/**
 * The ledger's charge side (candidate B): a tracked game charges each lineup
 * player a per_game_share debit, so the Outstanding Balance is real — before,
 * only payment_received credits existed and the balance clamped to zero.
 */
let eventId = "";
let gameId = "";
let anaEpId = "";

async function seed() {
  const u1 = await prisma.user.create({ data: { id: "u-ana", name: "Ana", email: "ana@t.com", emailVerified: false } });
  const u2 = await prisma.user.create({ data: { id: "u-bruno", name: "Bruno", email: "bruno@t.com", emailVerified: false } });

  const event = await prisma.event.create({
    data: { title: "Charge", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B", maxPlayers: 2 },
  });
  eventId = event.id;
  await prisma.eventCost.create({ data: { eventId, totalAmount: 20, currency: "EUR" } });

  const game = await prisma.game.create({ data: { eventId, dateTime: new Date(), status: "upcoming" } });
  gameId = game.id;
  await prisma.event.update({ where: { id: eventId }, data: { currentGameId: gameId } });

  const ana = await prisma.eventPlayer.create({ data: { eventId, name: "Ana", userId: u1.id } });
  anaEpId = ana.id;
  const bruno = await prisma.eventPlayer.create({ data: { eventId, name: "Bruno", userId: u2.id } });
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: ana.id, order: 0, status: "active" } });
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: bruno.id, order: 1, status: "active" } });
}

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await seed();
});

describe("ledger charge side", () => {
  it("charges each lineup player a per_game_share debit and the balance reflects it", async () => {
    await syncGamePayments(gameId, eventId);

    const debits = await prisma.walletTransaction.findMany({ where: { eventId, reason: "per_game_share", direction: "debit" } });
    expect(debits).toHaveLength(2);
    expect(debits.every((d) => d.amountCents === 1000)).toBe(true); // 20 / maxPlayers 2

    const balance = await getOutstandingBalance(eventId, "Ana");
    expect(balance.amount).toBe(10);
    expect(balance.gamesOwed).toBe(1);
  });

  it("is idempotent across repeated syncs (no double charge)", async () => {
    await syncGamePayments(gameId, eventId);
    await syncGamePayments(gameId, eventId);
    expect(await prisma.walletTransaction.count({ where: { eventId, reason: "per_game_share" } })).toBe(2);
  });

  it("clears the balance once the share is settled", async () => {
    await syncGamePayments(gameId, eventId);
    await settleShare(eventId, gameId, anaEpId, "owner-1");
    expect((await getOutstandingBalance(eventId, "Ana")).amount).toBe(0);
  });

  it("does not charge a player who leaves the lineup", async () => {
    await syncGamePayments(gameId, eventId);
    await prisma.gameParticipant.updateMany({ where: { gameId, eventPlayerId: anaEpId }, data: { archivedAt: new Date() } });
    await syncGamePayments(gameId, eventId);
    const anaDebit = await prisma.walletTransaction.findFirst({ where: { eventId, reason: "per_game_share", userId: "u-ana" } });
    expect(anaDebit).toBeNull();
  });
});
