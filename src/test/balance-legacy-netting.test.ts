/**
 * Regression: legacy balance summary must NET `payment_received` wallet
 * transactions into the frozen `paymentsSnapshot` so that "Mark debt as
 * settled" actually clears the debt in the UI on the legacy read path.
 *
 * Before the fix, settling a historical payment created a WalletTransaction
 * row but the legacy balance summary still read the snapshot as `pending`
 * — so the user's debt never went away in the UI.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { getEventBalanceSummaryLegacy } from "~/lib/balance.legacy.server";
import { settleAllHistoricalForPlayer } from "~/lib/payments.server";

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany({ where: { id: { startsWith: "ghost:" } } });
  await prisma.user.deleteMany();
});

describe("getEventBalanceSummaryLegacy — net payment_received into snapshot", () => {
  it("excludes settled players from the outstanding balance", async () => {
    // 2-player event, 2 games, each with Elena as pending.
    const event = await prisma.event.create({
      data: {
        title: "Casa",
        location: "Pitch",
        dateTime: new Date("2026-06-15T20:00:00Z"),
        timezone: "UTC",
        maxPlayers: 4,
        eventCost: { create: { totalAmount: 20, currency: "EUR" } },
      },
      include: { eventCost: true },
    });
    await prisma.player.create({ data: { name: "Elena", eventId: event.id, order: 0 } });
    await prisma.player.create({ data: { name: "José", eventId: event.id, order: 1 } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Elena" } });
    const userId = `ghost:${ep.id}`;
    await prisma.user.create({ data: { id: userId, name: "Elena", email: `g-${ep.id}@x`, emailVerified: false } });
    await prisma.eventPlayer.update({ where: { id: ep.id }, data: { userId } });

    for (let g = 0; g < 2; g++) {
      const date = new Date(`2026-06-${String(g + 1).padStart(2, "0")}T20:00:00Z`);
      const gh = await prisma.gameHistory.create({
        data: {
          eventId: event.id,
          dateTime: date,
          status: "played",
          teamOneName: "A", teamTwoName: "B",
          teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Elena", order: 0 }] }]),
          paymentsSnapshot: JSON.stringify([{ playerName: "Elena", amount: 5, status: "pending", method: null }]),
          editableUntil: new Date(date.getTime() + 7 * 86400_000),
        },
      });
      await prisma.walletTransaction.create({
        data: {
          eventId: event.id, userId, amountCents: 500, currency: "EUR",
          direction: "debit", reason: "per_game_share",
          eventInstanceId: gh.id, gameHistoryId: gh.id, playerName: "Elena",
          idempotencyKey: `backfill:perGameShare:${gh.id}:Elena`,
          createdAt: date,
        },
      });
    }

    // Before settle: Elena owes 10.
    const before = await getEventBalanceSummaryLegacy(event.id);
    const elenaBefore = before.balances.find((b) => b.playerName === "Elena");
    expect(elenaBefore?.amount).toBeCloseTo(10, 1);

    // Settle everything for Elena.
    const result = await settleAllHistoricalForPlayer({
      eventId: event.id, playerName: "Elena", markedById: userId,
    });
    expect(result.settled).toBe(2);
    expect(result.failed).toBe(0);

    // After settle: Elena owes 0 (the snapshot view is netted by the
    // `payment_received` wallet transactions that settleHistoricalGame just
    // created). Before the fix this would still be ~10 because the legacy
    // summary didn't net those rows.
    const after = await getEventBalanceSummaryLegacy(event.id);
    const elenaAfter = after.balances.find((b) => b.playerName === "Elena");
    expect(elenaAfter).toBeUndefined();
  });
});
