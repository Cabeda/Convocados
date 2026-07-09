/**
 * Golden-master test for the WalletTransaction read path (ADR 0019).
 *
 * The new read path in balance.server.ts reads from the WalletTransaction
 * ledger. The legacy read path (balance.legacy.server.ts) reads from
 * PlayerPayment + GameHistory.paymentsSnapshot. For the same input data,
 * both implementations should produce the same per-player balance.
 *
 * Strategy: seed a "legacy" event (Player rows, PlayerPayment rows,
 * GameHistory with paymentsSnapshot), run the backfill, then compare
 * balances. After the backfill, both the ledger and the legacy data
 * are populated, so both code paths should return the same answer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  getOutstandingBalance as getOutstandingBalanceNew,
  getEventBalanceSummary as getEventBalanceSummaryNew,
  getGateBalance as getGateBalanceNew,
} from "~/lib/balance.server";
import {
  getOutstandingBalanceLegacy,
  getEventBalanceSummaryLegacy,
  getGateBalanceLegacy,
} from "~/lib/balance.legacy.server";

const _LEGACY = { WALLET_READ_PATH_ENABLED: "false" } as Record<string, string>;

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.monthlySubscription.deleteMany();
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
  // The seed script creates ghost users with id=ghost:{id} — clean them up
  await prisma.user.deleteMany({ where: { id: { startsWith: "ghost:" } } });
  await prisma.user.deleteMany();
  vi.resetModules();
});

async function seedLegacyState() {
  const event = await prisma.event.create({
    data: {
      title: "Test event",
      location: "Pitch",
      dateTime: new Date("2026-06-15T20:00:00Z"),
      timezone: "UTC",
      maxPlayers: 10,
      eventCost: {
        create: { totalAmount: 50, currency: "EUR" },
      },
    },
    include: { eventCost: true },
  });
  const ec = event.eventCost!;

  // 2 players, both ghost (no userId) — backfill should create ghost users
  await prisma.player.createMany({
    data: [
      { name: "Alice", eventId: event.id, order: 0 },
      { name: "Bob", eventId: event.id, order: 1 },
    ],
  });
  // Add 4 games with snapshots
  for (let g = 0; g < 4; g++) {
    const day = String(g + 1).padStart(2, "0");
    const date = new Date(`2026-05-${day}T20:00:00Z`);
    const playersInGame = g === 0 ? ["Alice", "Bob"] : g === 1 ? ["Alice"] : g === 2 ? ["Bob"] : ["Alice", "Bob"];
    const teams = [
      { team: "A", players: playersInGame.map((n, i) => ({ name: n, order: i })) },
    ];
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: date,
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify(teams),
        paymentsSnapshot: JSON.stringify(
          playersInGame.map((name) => ({
            playerName: name,
            amount: 50 / Math.max(playersInGame.length, 1),
            status: g % 2 === 0 ? "paid" : "pending",
            method: null,
          })),
        ),
        editableUntil: new Date(date.getTime() + 7 * 86400_000),
      },
    });
  }
  return { event, eventCost: ec };
}

describe("balance.server — golden master (legacy == new)", () => {
  it("legacy and new read paths return the same per-player balance after backfill", async () => {
    vi.stubEnv("WALLET_READ_PATH_ENABLED", "true");

    const { event } = await seedLegacyState();

    // Run the backfill inline (avoid the script's process.exit side effect).
    const eventCost = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
    if (!eventCost) throw new Error("missing eventCost");

    // Mirror the backfill for the test: create EventPlayer + ghost users
    // for each Player, then backfill per_game_share + payment_received.
    const players = await prisma.player.findMany({ where: { eventId: event.id } });
    for (const p of players) {
      const ep = await prisma.eventPlayer.findUnique({
        where: { eventId_name: { eventId: event.id, name: p.name } },
      });
      let epRow = ep;
      if (!epRow) {
        epRow = await prisma.eventPlayer.create({ data: { eventId: event.id, name: p.name } });
      }
      let userId = epRow.userId;
      if (!userId) {
        userId = `ghost:${epRow.id}`;
        await prisma.user.upsert({
          where: { id: userId },
          create: { id: userId, name: p.name, email: `ghost-${epRow.id}@system.local`, emailVerified: false },
          update: {},
        });
        await prisma.eventPlayer.update({ where: { id: epRow.id }, data: { userId } });
      }
    }

    const histories = await prisma.gameHistory.findMany({ where: { eventId: event.id } });
    for (const h of histories) {
      const members = h.teamsSnapshot
        ? (JSON.parse(h.teamsSnapshot) as Array<{ players: Array<{ name: string }> }>).flatMap((t) => t.players)
        : [];
      const epByName = new Map(
        (await prisma.eventPlayer.findMany({ where: { eventId: event.id } })).map((e) => [e.name, e]),
      );
      const shareCents = Math.round((50 / Math.max(members.length, 1)) * 100);
      for (const m of members) {
        const ep = epByName.get(m.name);
        if (!ep?.userId) continue;
        await prisma.walletTransaction.create({
          data: {
            eventId: event.id,
            userId: ep.userId,
            amountCents: shareCents,
            currency: "EUR",
            direction: "debit",
            reason: "per_game_share",
            eventInstanceId: h.id,
            gameHistoryId: h.id,
            playerName: m.name,
            idempotencyKey: `backfill:perGameShare:${h.id}:${m.name}`,
            createdAt: h.dateTime,
          },
        });
        // Snapshot entries: paid → payment_received
        const entries = h.paymentsSnapshot
          ? (JSON.parse(h.paymentsSnapshot) as Array<{ playerName: string; amount: number; status: string }>)
          : [];
        const entry = entries.find((e) => e.playerName === m.name);
        if (entry?.status === "paid") {
          await prisma.walletTransaction.create({
            data: {
              eventId: event.id,
              userId: ep.userId,
              amountCents: Math.round(entry.amount * 100),
              currency: "EUR",
              direction: "credit",
              reason: "payment_received",
              statusAfter: "paid",
              eventInstanceId: h.id,
              gameHistoryId: h.id,
              playerName: m.name,
              idempotencyKey: `backfill:snapshot:${h.id}:${m.name}`,
              createdAt: h.dateTime,
            },
          });
        }
      }
    }

    // Verify both code paths return equivalent balances
    const aliceNew = await getOutstandingBalanceNew(event.id, "Alice");
    const aliceLegacy = await getOutstandingBalanceLegacy(event.id, "Alice");
    expect(aliceNew.amount).toBeCloseTo(aliceLegacy.amount, 2);
    expect(aliceNew.gamesOwed).toBe(aliceLegacy.gamesOwed);

    const bobNew = await getOutstandingBalanceNew(event.id, "Bob");
    const bobLegacy = await getOutstandingBalanceLegacy(event.id, "Bob");
    expect(bobNew.amount).toBeCloseTo(bobLegacy.amount, 2);
    expect(bobNew.gamesOwed).toBe(bobLegacy.gamesOwed);

    // Event summary
    const summaryNew = await getEventBalanceSummaryNew(event.id);
    const summaryLegacy = await getEventBalanceSummaryLegacy(event.id);
    expect(summaryNew.balances.length).toBe(summaryLegacy.balances.length);
    for (let i = 0; i < summaryNew.balances.length; i++) {
      expect(summaryNew.balances[i].amount).toBeCloseTo(summaryLegacy.balances[i].amount, 2);
    }

    // Gate balance
    const aliceGateNew = await getGateBalanceNew(event.id, "Alice");
    const aliceGateLegacy = await getGateBalanceLegacy(event.id, "Alice");
    expect(aliceGateNew).toBeCloseTo(aliceGateLegacy, 2);
  }, 30_000);
});
