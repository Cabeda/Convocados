/**
 * ADR 0019 — Key tests for the ledger read-path switch.
 *
 * 1. computeMoneyBalance with mixed reasons (unit test)
 * 2. getOutstandingBalance routing: ledger vs legacy fallback (integration)
 * 3. Cost scope "this_game" sets Game override without mutating template (integration)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  computeMoneyBalance,
  MONEY_CLEARING_REASONS,
  OUTSTANDING_CLEARING_REASONS,
  type WalletTx,
} from "~/lib/wallet";
import { getOutstandingBalance } from "~/lib/balance.server";
import { PUT as putCost } from "~/pages/api/events/[id]/cost";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// ─── Helpers ───────────────────────────────────────────────────────────────

function tx(overrides: Partial<WalletTx> & { direction: WalletTx["direction"]; reason: WalletTx["reason"]; amountCents: number }): WalletTx {
  return {
    gameUnits: 0,
    createdAt: new Date(),
    eventInstanceId: "g1",
    idempotencyKey: null,
    ...overrides,
  };
}

function ctx(params: Record<string, string>, body?: unknown) {
  return {
    params,
    request: new Request("http://localhost/api/events/x/cost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  } as any;
}

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
});

// ─── Test 1: computeMoneyBalance pure function ─────────────────────────────

describe("computeMoneyBalance", () => {
  it("sums charging debits minus clearing credits, ignoring unit-only rows", () => {
    const txs: WalletTx[] = [
      tx({ direction: "debit", reason: "per_game_share", amountCents: 550 }),
      tx({ direction: "debit", reason: "cost_adjustment", amountCents: 100 }),
      tx({ direction: "credit", reason: "payment_received", amountCents: 550 }),
      // missed_game_credit is unit-only — should not affect money balance
      tx({ direction: "credit", reason: "missed_game_credit", amountCents: 500, gameUnits: 1, eventInstanceId: "g2" }),
      tx({ direction: "credit", reason: "payment_self_reported", amountCents: 100 }),
    ];

    // Gate: all clearing reasons (received + self_reported + redeemed) → 650 - 650 = 0
    expect(computeMoneyBalance(txs, MONEY_CLEARING_REASONS)).toBe(0);

    // Outstanding: excludes self_reported → 650 - 550 = 100 cents still owed
    expect(computeMoneyBalance(txs, OUTSTANDING_CLEARING_REASONS)).toBe(100);
  });

  it("returns negative when credits exceed debits (overpay)", () => {
    const txs: WalletTx[] = [
      tx({ direction: "debit", reason: "per_game_share", amountCents: 500 }),
      tx({ direction: "credit", reason: "payment_received", amountCents: 700 }),
    ];
    // No clamp — raw balance is -200
    expect(computeMoneyBalance(txs, OUTSTANDING_CLEARING_REASONS)).toBe(-200);
  });
});

// ─── Test 2: getOutstandingBalance routing ─────────────────────────────────

describe("getOutstandingBalance ledger vs legacy routing", () => {
  it("reads from ledger when rows exist, legacy when they don't, legacy for anonymous", async () => {
    const user = await prisma.user.create({
      data: { id: "u-route", name: "Alice", email: "route@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "Route Test", location: "L", dateTime: new Date() },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "Alice", userId: user.id } });

    // Legacy PlayerPayment exists (no ledger rows yet)
    const ec = await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 10 } });
    await prisma.playerPayment.create({
      data: { eventCostId: ec.id, playerName: "Alice", amount: 5, status: "pending" },
    });

    // Should fall back to legacy (no WalletTransaction rows)
    const legacy = await getOutstandingBalance(event.id, "Alice");
    expect(legacy.amount).toBe(5);

    // Now add a ledger debit — should switch to ledger path
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: user.id, amountCents: 700, currency: "EUR",
        direction: "debit", gameUnits: 0, reason: "per_game_share", eventInstanceId: event.id,
      },
    });
    const fromLedger = await getOutstandingBalance(event.id, "Alice");
    expect(fromLedger.amount).toBe(7); // 700 cents from ledger, not €5 from PlayerPayment

    // Anonymous player — always falls back to legacy
    await prisma.player.create({ data: { eventId: event.id, name: "Ghost" } });
    await prisma.playerPayment.create({
      data: { eventCostId: ec.id, playerName: "Ghost", amount: 3, status: "pending" },
    });
    const anon = await getOutstandingBalance(event.id, "Ghost");
    expect(anon.amount).toBe(3);
  });
});

// ─── Test 3: Cost scope "this_game" ────────────────────────────────────────

describe("PUT /api/events/[id]/cost scope=this_game", () => {
  it("sets Game.costTotalAmount without changing EventCost.totalAmount", async () => {
    const event = await prisma.event.create({
      data: { title: "Cost Scope", location: "L", dateTime: new Date(), maxPlayers: 5 },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date() } });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 50, currency: "EUR" } });
    await prisma.player.create({ data: { eventId: event.id, name: "Alice" } });

    const res = await putCost(ctx({ id: event.id }, { totalAmount: 70, currency: "EUR", scope: "this_game" }));
    expect(res.status).toBe(200);

    // Game override set
    const updatedGame = await prisma.game.findUnique({ where: { id: game.id } });
    expect(updatedGame?.costTotalAmount).toBe(70);
    expect(updatedGame?.costCurrency).toBe("EUR");

    // Template unchanged
    const template = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
    expect(template?.totalAmount).toBe(50);
  });
});
