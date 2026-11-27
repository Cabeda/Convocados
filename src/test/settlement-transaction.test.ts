import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const ledgerState = vi.hoisted(() => ({ shareCalls: 0, failOnShareCall: 0 }));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ledger.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ledger.server")>();
  return {
    ...actual,
    postLedgerEntry: async (
      entry: Parameters<typeof actual.postLedgerEntry>[0],
      client?: Parameters<typeof actual.postLedgerEntry>[1],
    ) => {
      if (entry.reason === "per_game_share") {
        ledgerState.shareCalls += 1;
        if (ledgerState.failOnShareCall > 0 && ledgerState.shareCalls >= ledgerState.failOnShareCall) {
          throw new Error("injected debit failure");
        }
      }
      return actual.postLedgerEntry(entry, client);
    },
  };
});

import { syncGamePayments } from "~/lib/settlement.server";

async function seedGame() {
  const event = await prisma.event.create({
    data: {
      title: "Atomic settlement",
      location: "Pitch",
      dateTime: new Date(),
      maxPlayers: 10,
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  await prisma.eventCost.create({
    data: { eventId: event.id, totalAmount: 60, currency: "EUR" },
  });

  const charged: string[] = [];
  for (const [order, name] of ["Ana", "Bruno", "Carla"].entries()) {
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name } });
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: ep.id, order },
    });
    charged.push(ep.id);
  }

  const benched = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Bench" } });
  await prisma.gameParticipant.create({
    data: { gameId: game.id, eventPlayerId: benched.id, order: 10 },
  });
  await prisma.gamePayment.create({
    data: {
      gameId: game.id,
      eventPlayerId: benched.id,
      playerName: "Bench",
      amount: 6,
      status: "pending",
    },
  });

  return { event, game, charged, benched };
}

beforeEach(async () => {
  ledgerState.shareCalls = 0;
  ledgerState.failOnShareCall = 0;
  await prisma.gamePayment.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("syncGamePayments atomicity", () => {
  it("rolls back archive, upserts and debits when a debit throws mid-sync", async () => {
    const { event, game, charged } = await seedGame();
    ledgerState.failOnShareCall = 2;

    await expect(syncGamePayments(game.id, event.id)).rejects.toThrow("injected debit failure");

    expect(
      await prisma.gamePayment.count({ where: { gameId: game.id, archivedAt: { not: null } } }),
    ).toBe(0);
    expect(
      await prisma.gamePayment.count({
        where: { gameId: game.id, eventPlayerId: { in: charged } },
      }),
    ).toBe(0);
    expect(
      await prisma.walletTransaction.count({
        where: { eventId: event.id, eventInstanceId: game.id, reason: "per_game_share" },
      }),
    ).toBe(0);
  });
});
