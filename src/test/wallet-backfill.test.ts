/**
 * Smoke test for the backfill script's idempotency and correctness.
 * Runs the script logic inline (avoiding its process.exit side effect).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { ensureEventPlayerForPlayer } from "./_backfill-helpers";
import { getOutstandingBalance } from "~/lib/balance.server";

vi.stubEnv("WALLET_READ_PATH_ENABLED", "true");

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
  await prisma.user.deleteMany();
});

async function runInlineBackfill(eventId: string) {
  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!eventCost) return { created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;

  // Step 1: ensure EventPlayer for every Player
  const players = await prisma.player.findMany({ where: { eventId } });
  for (const p of players) {
    await ensureEventPlayerForPlayer(p);
  }

  // Step 2: backfill PlayerPayment
  const playerPayments = await prisma.playerPayment.findMany({
    where: { eventCostId: eventCost.id },
  });
  for (const pp of playerPayments) {
    const key = `backfill:playerPayment:${pp.id}`;
    const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey: key } });
    if (existing) { skipped++; continue; }
    const player = await prisma.player.findFirst({ where: { eventId, name: pp.playerName } });
    if (!player) { skipped++; continue; }
    const { userId } = await ensureEventPlayerForPlayer(player);
    if (!userId) { skipped++; continue; }
    if (pp.status === "paid") {
      await prisma.walletTransaction.create({
        data: {
          eventId,
          userId,
          amountCents: Math.round(pp.amount * 100),
          currency: eventCost.currency,
          direction: "credit",
          reason: "payment_received",
          statusAfter: "paid",
          eventInstanceId: eventId,
          markedById: pp.markedBy ?? undefined,
          playerName: pp.playerName,
          idempotencyKey: key,
        },
      });
      created++;
    } else if (pp.status === "sent") {
      await prisma.walletTransaction.create({
        data: {
          eventId,
          userId,
          amountCents: Math.round(pp.amount * 100),
          currency: eventCost.currency,
          direction: "credit",
          reason: "payment_self_reported",
          statusAfter: "sent",
          eventInstanceId: eventId,
          playerName: pp.playerName,
          idempotencyKey: key,
        },
      });
      created++;
    }
  }

  // Step 3: backfill paymentsSnapshot entries
  const histories = await prisma.gameHistory.findMany({ where: { eventId, paymentsSnapshot: { not: null } } });
  for (const h of histories) {
    if (!h.paymentsSnapshot) continue;
    let entries: Array<{ playerName: string; amount: number; status: string }>;
    try { entries = JSON.parse(h.paymentsSnapshot); } catch { continue; }
    const gameEnd = new Date(h.dateTime.getTime() + 3600_000);
    for (const entry of entries) {
      const key = `backfill:snapshot:${h.id}:${entry.playerName}`;
      const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey: key } });
      if (existing) { skipped++; continue; }
      const player = await prisma.player.findFirst({ where: { eventId, name: entry.playerName } });
      if (!player) { skipped++; continue; }
      const { userId } = await ensureEventPlayerForPlayer(player);
      if (!userId) { skipped++; continue; }
      if (entry.status === "paid" || entry.status === "sent") {
        await prisma.walletTransaction.create({
          data: {
            eventId,
            userId,
            amountCents: Math.round(entry.amount * 100),
            currency: eventCost.currency,
            direction: "credit",
            reason: entry.status === "paid" ? "payment_received" : "payment_self_reported",
            statusAfter: entry.status,
            eventInstanceId: eventId,
            gameHistoryId: h.id,
            playerName: entry.playerName,
            idempotencyKey: key,
            createdAt: gameEnd,
          },
        });
        created++;
      }
    }
  }

  return { created, skipped };
}

describe("wallet backfill (idempotency)", () => {
  it("is idempotent on re-run", async () => {
    const event = await prisma.event.create({
      data: {
        title: "T", location: "Pitch", dateTime: new Date(), maxPlayers: 5,
        eventCost: { create: { totalAmount: 50, currency: "EUR" } },
      },
      include: { eventCost: true },
    });
    const ec = event.eventCost!;
    await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 0 } });
    await prisma.playerPayment.create({ data: { eventCostId: ec.id, playerName: "Alice", amount: 10, status: "paid" } });

    const r1 = await runInlineBackfill(event.id);
    expect(r1.created).toBeGreaterThan(0);

    const r2 = await runInlineBackfill(event.id);
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(r1.created);
  });

  it("creates ghost users for players without userId", async () => {
    const event = await prisma.event.create({
      data: {
        title: "T", location: "Pitch", dateTime: new Date(), maxPlayers: 5,
        eventCost: { create: { totalAmount: 50, currency: "EUR" } },
      },
      include: { eventCost: true },
    });
    const ec = event.eventCost!;
    await prisma.player.create({ data: { name: "Ghost", eventId: event.id, order: 0 } });
    await prisma.playerPayment.create({ data: { eventCostId: ec.id, playerName: "Ghost", amount: 10, status: "paid" } });

    const r = await runInlineBackfill(event.id);
    expect(r.created).toBeGreaterThan(0);

    // Should now have a ghost user
    const ghostUser = await prisma.user.findFirst({ where: { name: "Ghost", id: { startsWith: "ghost:" } } });
    expect(ghostUser).not.toBeNull();
  });

  it("Gonçalo scenario: 2 pending historical games → balance is 10€ before settle, 0€ after", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Ninjas", location: "Pitch",
        dateTime: new Date("2026-07-13T18:00:00Z"),
        timezone: "Europe/Lisbon", maxPlayers: 10,
        eventCost: { create: { totalAmount: 50, currency: "EUR" } },
      },
      include: { eventCost: true },
    });
    await prisma.player.create({ data: { name: "Gonçalo", eventId: event.id, order: 0 } });
    for (let g = 0; g < 2; g++) {
      const day = String(g + 1).padStart(2, "0");
      const date = new Date(`2026-06-${day}T18:00:00Z`);
      await prisma.gameHistory.create({
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
    }
    // Also a per_game_share debit per game (matches the backfill)
    const histories = await prisma.gameHistory.findMany({ where: { eventId: event.id } });
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Gonçalo" } });
    // Create ghost user + link EventPlayer
    const userId = `ghost:${ep.id}`;
    await prisma.user.create({ data: { id: userId, name: "Gonçalo", email: `ghost-${ep.id}@system.local`, emailVerified: false } });
    await prisma.eventPlayer.update({ where: { id: ep.id }, data: { userId } });
    for (const h of histories) {
      await prisma.walletTransaction.create({
        data: {
          eventId: event.id,
          userId,
          amountCents: 500,
          currency: "EUR",
          direction: "debit",
          reason: "per_game_share",
          eventInstanceId: h.id,
          gameHistoryId: h.id,
          playerName: "Gonçalo",
          idempotencyKey: `backfill:perGameShare:${h.id}:Gonçalo`,
          createdAt: h.dateTime,
        },
      });
    }

    const bal = await getOutstandingBalance(event.id, "Gonçalo");
    expect(bal.amount).toBeCloseTo(10);
    expect(bal.gamesOwed).toBe(2);

    // Settle one game → balance should drop to 5€
    const { settleHistoricalGame } = await import("~/lib/payments.server");
    await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: histories[0].id,
      playerName: "Gonçalo",
      markedById: userId,
    });

    const bal2 = await getOutstandingBalance(event.id, "Gonçalo");
    expect(bal2.amount).toBeCloseTo(5);
    expect(bal2.gamesOwed).toBe(1);

    // Settle the second → 0€
    await settleHistoricalGame({
      eventId: event.id,
      gameHistoryId: histories[1].id,
      playerName: "Gonçalo",
      markedById: userId,
    });
    const bal3 = await getOutstandingBalance(event.id, "Gonçalo");
    expect(bal3.amount).toBeCloseTo(0);
    expect(bal3.gamesOwed).toBe(0);
  }, 30_000);
});
