import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { selfReportSent } from "~/lib/settlement.server";
import { getGateBalance, getOutstandingBalance } from "~/lib/balance.server";

/**
 * Candidate E — the two self-report paths must agree. The per-game route
 * (`selfReportSent`) previously flipped GamePayment to "sent" with no ledger
 * row, while the legacy route wrote one. Both must now post
 * `payment_self_reported` (ADR 0006: `sent` clears the gate, not the balance).
 */
let eventId = "";
let gameId = "";
let epId = "";

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({ data: { id: "u-ana", name: "Ana", email: "ana@t.com", emailVerified: false } });
  const event = await prisma.event.create({
    data: { title: "SelfReport", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B", maxPlayers: 1 },
  });
  eventId = event.id;
  await prisma.eventCost.create({ data: { eventId, totalAmount: 10, currency: "EUR" } });
  const game = await prisma.game.create({ data: { eventId, dateTime: new Date(), status: "upcoming" } });
  gameId = game.id;
  await prisma.event.update({ where: { id: eventId }, data: { currentGameId: gameId } });
  const ep = await prisma.eventPlayer.create({ data: { eventId, name: "Ana", userId: user.id } });
  epId = ep.id;
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: ep.id, order: 0, status: "active" } });
  await prisma.gamePayment.create({ data: { gameId, eventPlayerId: ep.id, playerName: "Ana", amount: 10, status: "pending" } });
});

describe("selfReportSent writes the ledger", () => {
  it("marks the share sent and posts a payment_self_reported credit for the payer", async () => {
    await selfReportSent(gameId, epId);

    const gp = await prisma.gamePayment.findUnique({ where: { gameId_eventPlayerId: { gameId, eventPlayerId: epId } } });
    expect(gp?.status).toBe("sent");

    const tx = await prisma.walletTransaction.findFirst({ where: { eventId, reason: "payment_self_reported", userId: "u-ana" } });
    expect(tx).toMatchObject({ amountCents: 1000, direction: "credit", statusAfter: "sent", eventInstanceId: gameId });
  });

  it("clears the gate but leaves the balance owed (ADR 0006)", async () => {
    // A charge must exist for the gate/balance to be meaningful.
    await prisma.walletTransaction.create({
      data: { eventId, userId: "u-ana", amountCents: 1000, currency: "EUR", direction: "debit", reason: "per_game_share", eventInstanceId: gameId },
    });
    await selfReportSent(gameId, epId);

    expect(await getGateBalance(eventId, "Ana")).toBe(0);
    expect((await getOutstandingBalance(eventId, "Ana")).amount).toBe(10);
  });

  it("rejects a second self-report", async () => {
    await selfReportSent(gameId, epId);
    await expect(selfReportSent(gameId, epId)).rejects.toThrow(/pending/i);
  });
});
