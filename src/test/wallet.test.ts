import { describe, it, expect } from "vitest";
import {
  computeAvailableUnits,
  computeAvailableUnitsDetailed,
  sumTransactionAmountCents,
  type WalletTx,
} from "~/lib/wallet";

function credit(args: {
  reason: WalletTx["reason"];
  gameUnits?: number;
  amountCents?: number;
  createdAt: string;
  eventInstanceId?: string | null;
  idempotencyKey?: string | null;
}): WalletTx {
  return {
    direction: "credit",
    reason: args.reason,
    gameUnits: args.gameUnits ?? 0,
    amountCents: args.amountCents ?? 0,
    createdAt: new Date(args.createdAt),
    eventInstanceId: args.eventInstanceId ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
  };
}

function debit(args: {
  reason: WalletTx["reason"];
  amountCents: number;
  createdAt: string;
  eventInstanceId?: string | null;
}): WalletTx {
  return {
    direction: "debit",
    reason: args.reason,
    gameUnits: 0,
    amountCents: args.amountCents,
    createdAt: new Date(args.createdAt),
    eventInstanceId: args.eventInstanceId ?? null,
    idempotencyKey: null,
  };
}

describe("computeAvailableUnits", () => {
  it("returns 0 for an empty ledger", () => {
    expect(computeAvailableUnits([])).toBe(0);
  });

  it("returns 1 after a single missed_game_credit", () => {
    const txs: WalletTx[] = [
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-15T20:00:00Z" }),
    ];
    expect(computeAvailableUnits(txs)).toBe(1);
  });

  it("reduces by 1 after a credit_redeemed", () => {
    const txs: WalletTx[] = [
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-15T20:00:00Z" }),
      credit({ reason: "credit_redeemed", gameUnits: -1, amountCents: 0, createdAt: "2026-06-22T20:00:00Z" }),
    ];
    expect(computeAvailableUnits(txs)).toBe(0);
  });

  it("reduces by 1 after credit_expired (and the expired row is part of the ledger)", () => {
    const txs: WalletTx[] = [
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-15T20:00:00Z" }),
      credit({ reason: "credit_expired", gameUnits: -1, amountCents: 500, createdAt: "2026-07-31T23:59:00Z" }),
    ];
    expect(computeAvailableUnits(txs)).toBe(0);
  });

  it("sums multiple missed_game_credit rows", () => {
    const txs: WalletTx[] = [
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-15T20:00:00Z" }),
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-22T20:00:00Z" }),
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-29T20:00:00Z" }),
    ];
    expect(computeAvailableUnits(txs)).toBe(3);
  });

  it("does not count monthly_fee, per_game_share, payment_received, or extras_declare in units", () => {
    const txs: WalletTx[] = [
      debit({ reason: "monthly_fee", amountCents: 2000, createdAt: "2026-06-01T00:00:00Z" }),
      debit({ reason: "per_game_share", amountCents: 500, createdAt: "2026-06-08T20:00:00Z" }),
      credit({ reason: "payment_received", amountCents: 500, createdAt: "2026-06-09T20:00:00Z" }),
      credit({ reason: "extras_declare", amountCents: 1500, createdAt: "2026-08-01T00:00:00Z" }),
    ];
    expect(computeAvailableUnits(txs)).toBe(0);
  });

  it("returns a negative number if credit_redeemed exceeds credit earned (regression guard)", () => {
    const txs: WalletTx[] = [
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-15T20:00:00Z" }),
      credit({ reason: "credit_redeemed", gameUnits: -1, amountCents: 0, createdAt: "2026-06-22T20:00:00Z" }),
      credit({ reason: "credit_redeemed", gameUnits: -1, amountCents: 0, createdAt: "2026-06-29T20:00:00Z" }),
    ];
    expect(computeAvailableUnits(txs)).toBe(-1);
  });
});

describe("computeAvailableUnitsDetailed", () => {
  it("returns a per-row breakdown with running balance and a final total", () => {
    const txs: WalletTx[] = [
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-15T20:00:00Z" }),
      credit({ reason: "credit_redeemed", gameUnits: -1, amountCents: 0, createdAt: "2026-06-22T20:00:00Z" }),
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-29T20:00:00Z" }),
    ];
    const result = computeAvailableUnitsDetailed(txs);
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].runningTotal).toBe(1);
    expect(result.rows[1].runningTotal).toBe(0);
    expect(result.rows[2].runningTotal).toBe(1);
  });

  it("ignores non-unit rows in the breakdown (they have 0 contribution)", () => {
    const txs: WalletTx[] = [
      debit({ reason: "monthly_fee", amountCents: 2000, createdAt: "2026-06-01T00:00:00Z" }),
      credit({ reason: "missed_game_credit", gameUnits: 1, amountCents: 500, createdAt: "2026-06-15T20:00:00Z" }),
    ];
    const result = computeAvailableUnitsDetailed(txs);
    expect(result.total).toBe(1);
    expect(result.rows[0].delta).toBe(0);
    expect(result.rows[1].delta).toBe(1);
  });
});

describe("sumTransactionAmountCents", () => {
  it("sums debits as positive and credits as negative (net owed)", () => {
    const txs: WalletTx[] = [
      debit({ reason: "per_game_share", amountCents: 500, createdAt: "2026-06-08T20:00:00Z" }),
      credit({ reason: "credit_redeemed", amountCents: 0, createdAt: "2026-06-08T20:05:00Z" }),
      credit({ reason: "payment_received", amountCents: 500, createdAt: "2026-06-09T20:00:00Z" }),
    ];
    expect(sumTransactionAmountCents(txs)).toBe(0);
  });

  it("returns the outstanding amount when only debits are recorded", () => {
    const txs: WalletTx[] = [
      debit({ reason: "per_game_share", amountCents: 500, createdAt: "2026-06-08T20:00:00Z" }),
    ];
    expect(sumTransactionAmountCents(txs)).toBe(500);
  });

  it("ignores missed_game_credit and credit_expired (they are unit-only, not money owed by the player)", () => {
    const txs: WalletTx[] = [
      credit({ reason: "missed_game_credit", amountCents: 500, createdAt: "2026-06-15T20:00:00Z" }),
      credit({ reason: "credit_expired", amountCents: 500, createdAt: "2026-07-31T23:59:00Z" }),
    ];
    expect(sumTransactionAmountCents(txs)).toBe(0);
  });

  it("counts payment_self_reported (sent) as a credit — it does not clear the balance, but it does offset the owed amount for the purpose of the join gate", () => {
    const txs: WalletTx[] = [
      debit({ reason: "per_game_share", amountCents: 500, createdAt: "2026-06-08T20:00:00Z" }),
      credit({ reason: "payment_self_reported", amountCents: 500, createdAt: "2026-06-09T10:00:00Z" }),
    ];
    expect(sumTransactionAmountCents(txs)).toBe(0);
  });
});
