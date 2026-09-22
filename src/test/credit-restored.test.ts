import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { cancelCurrentGame } from "~/lib/cancelEvent.server";
import { computeAvailableUnits, type WalletTx } from "~/lib/wallet";

/**
 * Candidate A-rest — the ledger is append-only, so a redeemed Game Unit is
 * returned by a compensating `credit_restored` entry, not by deleting the
 * `credit_redeemed` row.
 */
let eventId = "";
let gameId = "";

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({ data: { id: "u-ana", name: "Ana", email: "ana@t.com", emailVerified: false } });
  const event = await prisma.event.create({
    data: { title: "Cancel", location: "P", dateTime: new Date(Date.now() + 3_600_000), durationMinutes: 60, teamOneName: "A", teamTwoName: "B" },
  });
  eventId = event.id;
  const game = await prisma.game.create({ data: { eventId, dateTime: new Date(Date.now() + 3_600_000), status: "upcoming" } });
  gameId = game.id;
  await prisma.event.update({ where: { id: eventId }, data: { currentGameId: gameId } });

  // A redeemed unit for this game (unit -1, no money).
  await prisma.walletTransaction.create({
    data: { eventId, userId: user.id, amountCents: 0, currency: "EUR", direction: "credit", gameUnits: -1, reason: "credit_redeemed", eventInstanceId: gameId },
  });
});

describe("cancelCurrentGame restores redeemed credit", () => {
  it("posts a compensating credit_restored entry and keeps the original row", async () => {
    await cancelCurrentGame(eventId, { id: "u-ana", name: "Ana" });

    const restored = await prisma.walletTransaction.findFirst({ where: { eventId, reason: "credit_restored", userId: "u-ana" } });
    expect(restored).toMatchObject({ gameUnits: 1, amountCents: 0, direction: "credit", eventInstanceId: gameId });

    // The original redemption is not deleted — the ledger stays append-only.
    expect(await prisma.walletTransaction.count({ where: { eventId, reason: "credit_redeemed" } })).toBe(1);

    const txs = await prisma.walletTransaction.findMany({ where: { eventId, userId: "u-ana" } });
    expect(computeAvailableUnits(txs as unknown as WalletTx[])).toBe(0); // -1 redeemed + 1 restored
  });
});
