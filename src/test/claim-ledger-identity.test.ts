/**
 * A claimed roster row inherits the money history of the anonymous player it
 * replaces (ADR 0026). The ledger keys money on a User id and freezes that id
 * inside the share idempotency key, so the claim must move the rows *and*
 * rewrite the key — otherwise the debtor's own balance reads 0 and the next
 * sync charges the same share a second time under the new identity.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { syncGamePayments } from "~/lib/settlement.server";
import { getOutstandingBalance, getGateBalance } from "~/lib/balance.server";
import { claimPlayer } from "~/lib/claimPlayer.server";
import { systemUserId } from "~/lib/payerIdentity.server";

let eventId = "";
let gameId = "";
let guestEpId = "";

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  const owner = await prisma.user.create({
    data: { id: "owner-claim-ledger", name: "Owner", email: "owner@claimledger.test", emailVerified: true },
  });
  const event = await prisma.event.create({
    data: { title: "Claim ledger", location: "Pitch", dateTime: new Date(), maxPlayers: 2, ownerId: owner.id },
  });
  eventId = event.id;
  await prisma.eventCost.create({ data: { eventId, totalAmount: 20, currency: "EUR" } });

  const game = await prisma.game.create({ data: { eventId, dateTime: new Date(), status: "upcoming" } });
  gameId = game.id;
  await prisma.event.update({ where: { id: eventId }, data: { currentGameId: gameId } });

  const guest = await prisma.eventPlayer.create({ data: { eventId, name: "Guest" } });
  guestEpId = guest.id;
  await prisma.gameParticipant.create({
    data: { gameId, eventPlayerId: guest.id, order: 0, status: "active" },
  });
});

describe("claiming an anonymous player inherits their ledger", () => {
  it("moves the share debit to the claiming account instead of leaving it on the old system id", async () => {
    await syncGamePayments(gameId, eventId);

    const systemId = systemUserId(eventId, "Guest");
    expect(
      await prisma.walletTransaction.count({
        where: { eventId, userId: systemId, reason: "per_game_share", direction: "debit" },
      }),
    ).toBe(1);

    const user = await prisma.user.create({
      data: { id: "u-claimer", name: "New Name", email: "claimer@test.com", emailVerified: true },
    });
    await claimPlayer(eventId, { playerId: guestEpId, userId: user.id, userName: user.name });

    expect(await prisma.walletTransaction.count({ where: { eventId, userId: systemId } })).toBe(0);

    const outstanding = await getOutstandingBalance(eventId, "New Name");
    expect(outstanding.amount).toBe(10);
    expect(outstanding.gamesOwed).toBe(1);
    expect(await getGateBalance(eventId, "New Name")).toBe(10);
  });

  it("leaves exactly one per-game share debit after a later sync under the new identity", async () => {
    await syncGamePayments(gameId, eventId);

    const user = await prisma.user.create({
      data: { id: "u-claimer-two", name: "Second Name", email: "claimer2@test.com", emailVerified: true },
    });
    await claimPlayer(eventId, { playerId: guestEpId, userId: user.id, userName: user.name });

    await syncGamePayments(gameId, eventId);

    const debits = await prisma.walletTransaction.findMany({
      where: { eventId, userId: user.id, reason: "per_game_share", direction: "debit" },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0].idempotencyKey).toBe(`share:${eventId}:${user.id}:${gameId}`);
    expect(
      await prisma.walletTransaction.count({
        where: { eventId, reason: "per_game_share", direction: "debit" },
      }),
    ).toBe(1);
    expect((await getOutstandingBalance(eventId, user.name)).amount).toBe(10);
  });
});
