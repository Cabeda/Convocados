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

/** Reasons that create a money debt for the player (debits). ADR 0019. */
export const MONEY_CHARGING_REASONS = new Set<WalletTxReason>([
  "per_game_share",
  "cost_adjustment",
]);

/** Clearing reasons that reduce outstanding balance (excludes self-reported). ADR 0019. */
export const OUTSTANDING_CLEARING_REASONS = new Set<WalletTxReason>([
  "payment_received",
  "credit_redeemed",
]);

export type WalletTxReason =
  | "per_game_share"
  | "cost_adjustment"
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

/**
 * Compute money balance from ledger rows using configurable clearing reasons.
 * ADR 0019 — shared core for getGateBalance and getOutstandingBalance.
 *
 * - Sums debits where reason ∈ MONEY_CHARGING_REASONS
 * - Subtracts credits where reason ∈ the provided clearingReasons set
 * - Returns cents owed (positive = debt, negative = overpay/credit)
 */
export function computeMoneyBalance(
  txs: readonly WalletTx[],
  clearingReasons: ReadonlySet<WalletTxReason>,
): number {
  let balance = 0;
  for (const tx of txs) {
    if (MONEY_CHARGING_REASONS.has(tx.reason) && tx.direction === "debit") {
      balance += tx.amountCents;
    }
    if (clearingReasons.has(tx.reason) && tx.direction === "credit") {
      balance -= tx.amountCents;
    }
  }
  return balance;
}

/**
 * Compute money balance scoped to a specific game (by eventInstanceId).
 * Excludes legacy rows where eventInstanceId matches the eventId (ADR 0019 §3).
 * Returns cents owed for that game only. Used for per-game paid/total aggregates.
 */
export function computeMoneyBalanceForGame(
  txs: readonly WalletTx[],
  gameId: string,
  clearingReasons: ReadonlySet<WalletTxReason>,
): number {
  let balance = 0;
  for (const tx of txs) {
    if (tx.eventInstanceId !== gameId) continue;
    if (MONEY_CHARGING_REASONS.has(tx.reason) && tx.direction === "debit") {
      balance += tx.amountCents;
    }
    if (clearingReasons.has(tx.reason) && tx.direction === "credit") {
      balance -= tx.amountCents;
    }
  }
  return balance;
}

// ─── Per-game aggregates (moved from balance.server.ts — ADR 0019 review) ──

/** Internal: build per-game debit/credit map, excluding legacy eventInstanceId values. */
function buildPerGameAggregates(
  txs: readonly WalletTx[],
  clearingReasons: ReadonlySet<WalletTxReason>,
  excludeInstanceIds?: ReadonlySet<string>,
): Map<string, { debit: number; credit: number; latest: Date }> {
  const games = new Map<string, { debit: number; credit: number; latest: Date }>();

  for (const tx of txs) {
    const key = tx.eventInstanceId;
    if (!key) continue;
    // ADR 0019 §3: skip legacy rows where eventInstanceId = eventId
    if (excludeInstanceIds?.has(key)) continue;

    if (!games.has(key)) games.set(key, { debit: 0, credit: 0, latest: tx.createdAt });
    const g = games.get(key)!;
    if (MONEY_CHARGING_REASONS.has(tx.reason) && tx.direction === "debit") {
      g.debit += tx.amountCents;
    }
    if (clearingReasons.has(tx.reason) && tx.direction === "credit") {
      g.credit += tx.amountCents;
    }
    if (tx.createdAt > g.latest) g.latest = tx.createdAt;
  }
  return games;
}

/**
 * Count games with outstanding debt (debit > credit for that game).
 * Excludes legacy eventInstanceId values via excludeInstanceIds.
 */
export function countGamesOwed(
  txs: readonly WalletTx[],
  clearingReasons: ReadonlySet<WalletTxReason>,
  excludeInstanceIds?: ReadonlySet<string>,
): number {
  const games = buildPerGameAggregates(txs, clearingReasons, excludeInstanceIds);
  let count = 0;
  for (const [, g] of games) {
    if (g.debit > g.credit) count++;
  }
  return count;
}

/**
 * Compute consecutive paid-game streak (most recent first).
 * Games with no charge (monthly-covered) are skipped.
 * Excludes legacy eventInstanceId values via excludeInstanceIds.
 */
export function computeStreak(
  txs: readonly WalletTx[],
  clearingReasons: ReadonlySet<WalletTxReason>,
  excludeInstanceIds?: ReadonlySet<string>,
): number {
  const games = buildPerGameAggregates(txs, clearingReasons, excludeInstanceIds);

  const sorted = [...games.entries()]
    .sort((a, b) => b[1].latest.getTime() - a[1].latest.getTime());

  let streak = 0;
  for (const [, g] of sorted) {
    if (g.debit === 0) continue; // no charge for this game (monthly-covered)
    if (g.credit >= g.debit) streak++;
    else break;
  }
  return streak;
}
