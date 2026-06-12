/**
 * Wallet math — pure functions, no DB dependency.
 *
 * The Wallet is a per-(User, Event) running balance of "Game Units" (the
 * abstract denomination of missed-game credit) and a parallel running
 * money balance in Event currency. The DB layer is in `wallet.server.ts`;
 * everything in this file must stay pure.
 *
 * ADR 0007 — ledger is the single source of truth.
 * ADR 0008 — Game Units, end-of-following-month expiry, snapshot value.
 */

export const UNIT_AFFECTING_REASONS = new Set<WalletTxReason>([
  "missed_game_credit",
  "credit_redeemed",
  "credit_expired",
]);

export const MONEY_CLEARING_REASONS = new Set<WalletTxReason>([
  "payment_received",
  "payment_self_reported",
  "credit_redeemed",
]);

export type WalletTxReason =
  | "per_game_share"
  | "monthly_fee"
  | "missed_game_credit"
  | "credit_redeemed"
  | "credit_expired"
  | "extras_declare"
  | "payment_received"
  | "payment_self_reported";

export type WalletTxDirection = "debit" | "credit";

export interface WalletTx {
  direction: WalletTxDirection;
  reason: WalletTxReason;
  gameUnits: number;
  amountCents: number;
  createdAt: Date;
  eventInstanceId: string | null;
  idempotencyKey: string | null;
}

/**
 * Sum of Game Units available for redemption right now.
 * Positive = credit available. Zero = none. Negative = over-redeemed
 * (regression guard — should never happen under correct operation).
 */
export function computeAvailableUnits(txs: readonly WalletTx[]): number {
  let total = 0;
  for (const tx of txs) {
    if (!UNIT_AFFECTING_REASONS.has(tx.reason)) continue;
    total += tx.gameUnits;
  }
  return total;
}

export interface WalletDetailedRow {
  createdAt: Date;
  reason: WalletTxReason;
  direction: WalletTxDirection;
  gameUnits: number;
  amountCents: number;
  delta: number;
  runningTotal: number;
}

export interface WalletDetailedResult {
  total: number;
  rows: WalletDetailedRow[];
}

/**
 * Per-row breakdown of unit movements with a running balance.
 * Useful for the "Your activity" UI.
 */
export function computeAvailableUnitsDetailed(
  txs: readonly WalletTx[],
): WalletDetailedResult {
  const rows: WalletDetailedRow[] = [];
  let runningTotal = 0;

  for (const tx of txs) {
    const affectsUnits = UNIT_AFFECTING_REASONS.has(tx.reason);
    const delta = affectsUnits ? tx.gameUnits : 0;
    runningTotal += delta;
    rows.push({
      createdAt: tx.createdAt,
      reason: tx.reason,
      direction: tx.direction,
      gameUnits: tx.gameUnits,
      amountCents: tx.amountCents,
      delta,
      runningTotal,
    });
  }

  return { total: runningTotal, rows };
}

/**
 * Sum of (debits - credits) over money-bearing transactions only.
 *
 * A positive result means the player still owes that many cents for the
 * (filtered) scope of the ledger. A negative result is a refund/overpay
 * (also a regression guard).
 *
 * Unit-only rows (missed_game_credit, credit_expired) are excluded — they
 * are bookkeeping for the organizer's Extras Pot, not money owed by the
 * player. extras_declare is excluded because it is the organizer's own
 * declaration, not the player's debt.
 */
export function sumTransactionAmountCents(txs: readonly WalletTx[]): number {
  let total = 0;
  for (const tx of txs) {
    if (tx.reason === "missed_game_credit") continue;
    if (tx.reason === "credit_expired") continue;
    if (tx.reason === "extras_declare") continue;
    if (tx.direction === "debit") total += tx.amountCents;
    else total -= tx.amountCents;
  }
  return total;
}
