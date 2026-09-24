/**
 * Balance computation — reads from WalletTransaction ledger (ADR 0019).
 *
 * Two projections of the same ledger:
 * - getGateBalance: "sent" clears the gate (uses MONEY_CLEARING_REASONS)
 * - getOutstandingBalance: "sent" does NOT clear (uses OUTSTANDING_CLEARING_REASONS)
 *
 * For anonymous players (no userId linked), falls back to the legacy payment
 * roll reads — GamePayment rows per occurrence (ADR 0016), since the ledger
 * requires a userId.
 */

import { prisma } from "./db.server";
import {
  computeMoneyBalance,
  computeMoneyBalanceForGame,
  countGamesOwed,
  computeStreak,
  MONEY_CLEARING_REASONS,
  OUTSTANDING_CLEARING_REASONS,
  type WalletTx,
} from "./wallet";
import { summarizePayments } from "./paymentSummary";
import { resolveLinkedUserId } from "./payerIdentity.server";
import { occurrencePaymentRolls } from "./paymentRoll.server";

export interface PlayerBalance {
  playerName: string;
  amount: number; // total owed (euros, 2dp) — per getOutstandingBalance semantics
  gamesOwed: number; // number of games with unpaid amounts
  streak: number; // consecutive games paid in a row (most recent first)
}

export interface BalanceSummary {
  paidCount: number;
  totalCount: number;
  balances: PlayerBalance[];
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/** Resolve a playerName to a userId for ledger queries. Returns null if unlinked. */
async function resolveUserId(eventId: string, playerName: string): Promise<string | null> {
  return resolveLinkedUserId(eventId, playerName);
}

/** Project a raw WalletTransaction row to the WalletTx shape — the single
 * row→domain mapping used by every ledger read (per-player and event-wide). */
function projectLedgerRow(r: {
  direction: string;
  reason: string;
  gameUnits: number;
  amountCents: number;
  createdAt: Date;
  eventInstanceId: string | null;
  idempotencyKey: string | null;
}): WalletTx {
  return {
    direction: r.direction as WalletTx["direction"],
    reason: r.reason as WalletTx["reason"],
    gameUnits: r.gameUnits,
    amountCents: r.amountCents,
    createdAt: r.createdAt,
    eventInstanceId: r.eventInstanceId,
    idempotencyKey: r.idempotencyKey,
  };
}

const LEDGER_SELECT = {
  direction: true,
  reason: true,
  gameUnits: true,
  amountCents: true,
  createdAt: true,
  eventInstanceId: true,
  idempotencyKey: true,
} as const;

/** Fetch ledger rows for a (eventId, userId) pair, projected to WalletTx shape. */
async function fetchLedger(eventId: string, userId: string): Promise<WalletTx[]> {
  const rows = await prisma.walletTransaction.findMany({
    where: { eventId, userId },
    select: LEDGER_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(projectLedgerRow);
}

/** Event-wide ledger read — the one interface getEventBalanceSummary consumes
 * (userId → rows), instead of re-running its own row mapping. */
async function fetchEventLedger(eventId: string): Promise<Map<string, WalletTx[]>> {
  const rows = await prisma.walletTransaction.findMany({
    where: { eventId },
    select: { userId: true, ...LEDGER_SELECT },
    orderBy: { createdAt: "asc" },
  });
  const byUser = new Map<string, WalletTx[]>();
  for (const r of rows) {
    const list = byUser.get(r.userId) ?? [];
    list.push(projectLedgerRow(r));
    byUser.set(r.userId, list);
  }
  return byUser;
}

// ─── Legacy fallback for anonymous players ─────────────────────────────────

interface SnapshotEntry {
  playerName: string;
  amount: number;
  status: string;
}

/**
 * The one legacy read: the occurrence GamePayment rolls for every non-cancelled
 * Game (newest game first, ADR 0016). Every legacy projection below derives
 * from this instead of re-querying and re-parsing snapshots.
 */
async function loadLegacyPayments(eventId: string): Promise<{
  live: SnapshotEntry[];
  histories: SnapshotEntry[][];
}> {
  const rolls = await occurrencePaymentRolls(eventId);
  const live: SnapshotEntry[] = (rolls[0]?.payments ?? []).map((p) => ({
    playerName: p.playerName,
    amount: p.amount,
    status: p.status,
  }));
  const parsedHistories: SnapshotEntry[][] = rolls.slice(1).map((roll) =>
    roll.payments.map((p) => ({ playerName: p.playerName, amount: p.amount, status: p.status })),
  );
  return { live, histories: parsedHistories };
}

async function legacyGetOutstandingBalance(eventId: string, playerName: string): Promise<PlayerBalance> {
  const { live, histories } = await loadLegacyPayments(eventId);

  let amount = 0;
  let gamesOwed = 0;
  let streak = 0;
  let streakBroken = false;

  type GameEntry = { status: string; amt: number };
  const timeline: GameEntry[] = [];

  const liveEntry = live.find((p) => p.playerName === playerName);
  if (liveEntry) {
    timeline.push({ status: liveEntry.status, amt: liveEntry.amount });
  }

  for (const entries of histories) {
    const entry = entries.find((e) => e.playerName === playerName);
    if (entry) timeline.push({ status: entry.status, amt: entry.amount });
  }

  for (const g of timeline) {
    if (g.status === "pending" || g.status === "sent") {
      amount += g.amt;
      gamesOwed++;
      streakBroken = true;
    } else if (g.status === "paid" && !streakBroken) {
      streak++;
    } else {
      streakBroken = true;
    }
  }

  return { playerName, amount: Math.round(amount * 100) / 100, gamesOwed, streak };
}

async function legacyGetGateBalance(eventId: string, playerName: string): Promise<number> {
  const { live, histories } = await loadLegacyPayments(eventId);

  let amount = 0;

  for (const entries of histories) {
    const entry = entries.find((e) => e.playerName === playerName);
    if (entry && entry.status === "pending") {
      amount += entry.amount;
    }
  }

  const liveEntry = live.find((p) => p.playerName === playerName);
  if (liveEntry && liveEntry.status === "pending") {
    amount += liveEntry.amount;
  }

  return Math.round(amount * 100) / 100;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Load a player's ledger rows, or null when the player is unlinked or has no
 * ledger rows — the signal to fall back to the legacy PlayerPayment reads.
 */
async function loadLedger(eventId: string, playerName: string): Promise<WalletTx[] | null> {
  const userId = await resolveUserId(eventId, playerName);
  if (!userId) return null;
  const txs = await fetchLedger(eventId, userId);
  return txs.length === 0 ? null : txs;
}

/**
 * Compute the outstanding balance for a single player within an event.
 * "Sent" does NOT clear — player still owes until organizer confirms.
 * Returns amount in euros (2dp).
 */
export async function getOutstandingBalance(
  eventId: string,
  playerName: string,
): Promise<PlayerBalance> {
  const txs = await loadLedger(eventId, playerName);
  if (!txs) return legacyGetOutstandingBalance(eventId, playerName);

  const balanceCents = computeMoneyBalance(txs, OUTSTANDING_CLEARING_REASONS);
  // ADR 0019 §3: exclude legacy rows where eventInstanceId = eventId from per-game aggregates
  // Only apply when the event uses Game-based recurrence (has currentGameId)
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  const legacyIds = event?.currentGameId ? new Set([eventId]) : undefined;
  const gamesOwed = countGamesOwed(txs, OUTSTANDING_CLEARING_REASONS, legacyIds);
  const streak = computeStreak(txs, OUTSTANDING_CLEARING_REASONS, legacyIds);

  return {
    playerName,
    amount: Math.round(Math.max(0, balanceCents)) / 100,
    gamesOwed,
    streak,
  };
}

/**
 * Compute the "gate-blocking" balance for enforcement.
 * "Sent" clears the gate (ADR 0006). Returns amount in euros (2dp).
 */
export async function getGateBalance(
  eventId: string,
  playerName: string,
): Promise<number> {
  const txs = await loadLedger(eventId, playerName);
  if (!txs) return legacyGetGateBalance(eventId, playerName);

  const balanceCents = computeMoneyBalance(txs, MONEY_CLEARING_REASONS);
  return Math.round(Math.max(0, balanceCents)) / 100;
}

/**
 * Compute balances for all players + aggregate for latest game.
 * Used for the event balance page and social-proof display.
 */
export async function getEventBalanceSummary(eventId: string): Promise<BalanceSummary> {
  // Get the current game for per-game aggregates
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { currentGameId: true },
  });

  // One event-wide ledger read (shared row projection with the per-player path)
  const byUser = await fetchEventLedger(eventId);

  // Resolve userId → playerName for display
  const userIds = [...byUser.keys()];
  const eventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId, userId: { in: userIds } },
    select: { userId: true, name: true },
  });
  const userToName = new Map(eventPlayers.map((ep) => [ep.userId!, ep.name]));

  // Fallback for users not in EventPlayer (legacy Player table)
  const missingUserIds = userIds.filter((uid) => !userToName.has(uid));
  if (missingUserIds.length > 0) {
    const legacyPlayers = await prisma.player.findMany({
      where: { eventId, userId: { in: missingUserIds } },
      select: { userId: true, name: true },
    });
    for (const p of legacyPlayers) {
      if (p.userId) userToName.set(p.userId, p.name);
    }
  }

  // Compute per-player balances
  let balances: PlayerBalance[] = [];

  if (byUser.size > 0) {
    // Ledger-based balances
    const legacyIds = event?.currentGameId ? new Set([eventId]) : undefined;
    for (const [userId, txs] of byUser) {
      const balanceCents = computeMoneyBalance(txs, OUTSTANDING_CLEARING_REASONS);
      if (balanceCents <= 0) continue; // no debt
      const gamesOwed = countGamesOwed(txs, OUTSTANDING_CLEARING_REASONS, legacyIds);
      const playerName = userToName.get(userId) ?? userId;
      balances.push({
        playerName,
        amount: Math.round(balanceCents) / 100,
        gamesOwed,
        streak: 0, // computed on-demand per player via getOutstandingBalance
      });
    }
  } else {
    // Legacy fallback: compute debts from the one legacy read (occurrence
    // GamePayment rolls, ADR 0016). Anonymous players have no ledger rows.
    const { live, histories } = await loadLegacyPayments(eventId);

    const debts = new Map<string, { amount: number; gamesOwed: number }>();
    const addDebt = (entry: SnapshotEntry) => {
      if (entry.status === "pending" || entry.status === "sent") {
        const d = debts.get(entry.playerName) ?? { amount: 0, gamesOwed: 0 };
        d.amount += entry.amount;
        d.gamesOwed++;
        debts.set(entry.playerName, d);
      }
    };

    for (const entries of histories) {
      for (const e of entries) addDebt(e);
    }
    for (const p of live) addDebt(p);

    balances = [...debts.entries()].map(([playerName, { amount, gamesOwed }]) => ({
      playerName,
      amount: Math.round(amount * 100) / 100,
      gamesOwed,
      streak: 0,
    }));
  }

  // Per-game aggregate for social proof (paidCount/totalCount for current game)
  let paidCount = 0;
  let totalCount = 0;
  const currentGameId = event?.currentGameId;

  if (currentGameId) {
    for (const [, txs] of byUser) {
      // Check if this user has a charge for the current game
      const hasCharge = txs.some(
        (tx) => tx.eventInstanceId === currentGameId &&
          (tx.reason === "per_game_share" || tx.reason === "cost_adjustment") &&
          tx.direction === "debit",
      );
      if (!hasCharge) continue;
      totalCount++;
      const gameBalance = computeMoneyBalanceForGame(txs, currentGameId, OUTSTANDING_CLEARING_REASONS);
      if (gameBalance <= 0) paidCount++;
    }
  }

  // If no ledger data for current game, fall back to the one legacy read —
  // the newest occurrence GamePayment roll (live), then older rolls.
  if (totalCount === 0) {
    const { live, histories } = await loadLegacyPayments(eventId);
    if (live.length > 0) {
      const agg = summarizePayments(live);
      totalCount = agg.totalCount;
      paidCount = agg.paidCount;
    } else if (histories.length > 0) {
      const agg = summarizePayments(histories[0]);
      totalCount = agg.totalCount;
      paidCount = agg.paidCount;
    }
  }

  return { paidCount, totalCount, balances };
}
