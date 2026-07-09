/**
 * Outstanding Balance — reads from the WalletTransaction ledger (ADR 0007,
 * ADR 0019). The legacy read path (PlayerPayment + GameHistory.paymentsSnapshot)
 * is kept in `balance.legacy.server.ts` and selected by setting
 * `WALLET_READ_PATH_ENABLED=false` for instant rollback.
 *
 * Balance computation per (event, EventPlayer):
 *   owed = Σ per_game_share debits − Σ payment_received credits
 *          − Σ payment_self_reported credits (counts as not-yet-cleared)
 *   gamesOwed = number of distinct gameHistoryIds with an outstanding debit
 *   streak    = consecutive games (most recent first) with no outstanding
 *               debit, terminated by the first game that has one
 *
 * The `gate` balance only counts debits not matched by a `payment_received`
 * credit (NOT `payment_self_reported` — that still counts as owed, per the
 * existing gate semantics in CONTEXT.md: "Payment enforcement level").
 */
import { prisma } from "./db.server";
import { isWalletReadPathEnabled } from "./featureFlag.server";
import {
  getOutstandingBalanceLegacy,
  getEventBalanceSummaryLegacy,
  getGateBalanceLegacy,
} from "./balance.legacy.server";

export interface PlayerBalance {
  playerName: string;
  amount: number; // total owed (pending + sent) in major units (euros)
  gamesOwed: number;
  streak: number;
}

export interface BalanceSummary {
  paidCount: number;
  totalCount: number;
  balances: PlayerBalance[];
}

interface LedgerEntry {
  direction: "debit" | "credit";
  reason: string;
  amountCents: number;
  gameHistoryId: string | null;
  createdAt: Date;
}

async function getLedgerForEventPlayer(
  eventId: string,
  userId: string,
  playerName: string,
): Promise<LedgerEntry[]> {
  // The ledger is keyed on userId. For ghost players, the backfill created a
  // User with id = "ghost:{eventPlayerId}". For unrenamed EventPlayers, we
  // also fall back to the playerName column for safety.
  const rows = await prisma.walletTransaction.findMany({
    where: {
      eventId,
      OR: [
        { userId },
        { userId: { startsWith: "ghost:" }, playerName, eventId },
      ],
    },
    select: {
      direction: true,
      reason: true,
      amountCents: true,
      gameHistoryId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    direction: r.direction as LedgerEntry["direction"],
    reason: r.reason,
    amountCents: r.amountCents,
    gameHistoryId: r.gameHistoryId,
    createdAt: r.createdAt,
  }));
}

function sumOwedCents(txs: LedgerEntry[]): { owedCents: number; gamesOwed: number; streak: number } {
  // Group debits by gameHistoryId. A game is "owed" if it has a per_game_share
  // debit and no `payment_received` credit (a `payment_self_reported` credit
  // doesn't clear the debt for the purposes of the owed balance — see CONTEXT
  // Payment status lifecycle).
  const perGame = new Map<string, { debitCents: number; receivedCents: number; selfReportedCents: number; createdAt: Date }>();
  for (const tx of txs) {
    if (tx.reason === "per_game_share") {
      const key = tx.gameHistoryId ?? "_unscoped_";
      const cur = perGame.get(key) ?? { debitCents: 0, receivedCents: 0, selfReportedCents: 0, createdAt: tx.createdAt };
      cur.debitCents += tx.amountCents;
      perGame.set(key, cur);
    } else if (tx.reason === "payment_received" && tx.gameHistoryId) {
      const cur = perGame.get(tx.gameHistoryId) ?? { debitCents: 0, receivedCents: 0, selfReportedCents: 0, createdAt: tx.createdAt };
      cur.receivedCents += tx.amountCents;
      perGame.set(tx.gameHistoryId, cur);
    } else if (tx.reason === "payment_self_reported" && tx.gameHistoryId) {
      const cur = perGame.get(tx.gameHistoryId) ?? { debitCents: 0, receivedCents: 0, selfReportedCents: 0, createdAt: tx.createdAt };
      cur.selfReportedCents += tx.amountCents;
      perGame.set(tx.gameHistoryId, cur);
    }
  }
  let owedCents = 0;
  let gamesOwed = 0;
  for (const [, g] of perGame) {
    if (g.debitCents > g.receivedCents) {
      owedCents += g.debitCents - g.receivedCents;
      gamesOwed++;
    }
  }
  // Streak: most recent N consecutive games with no outstanding debit.
  // We sort by createdAt descending and stop at the first owed game.
  const sortedGames = [...perGame.entries()]
    .filter(([k]) => k !== "_unscoped_")
    .map(([_, g]) => g)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let streak = 0;
  for (const g of sortedGames) {
    if (g.debitCents > g.receivedCents) break;
    streak++;
  }
  return { owedCents, gamesOwed, streak };
}

async function resolveEventPlayerUserId(eventId: string, playerName: string): Promise<string | null> {
  const ep = await prisma.eventPlayer.findUnique({
    where: { eventId_name: { eventId, name: playerName } },
    select: { userId: true },
  });
  return ep?.userId ?? null;
}

export async function getOutstandingBalance(
  eventId: string,
  playerName: string,
): Promise<PlayerBalance> {
  if (!isWalletReadPathEnabled()) {
    return getOutstandingBalanceLegacy(eventId, playerName);
  }
  const userId = await resolveEventPlayerUserId(eventId, playerName);
  if (!userId) {
    // No EventPlayer link → no ledger. Return zero (caller can treat as
    // unattributable, which matches the CONTEXT.md "ghost player" rule).
    return { playerName, amount: 0, gamesOwed: 0, streak: 0 };
  }
  const txs = await getLedgerForEventPlayer(eventId, userId, playerName);
  const { owedCents, gamesOwed, streak } = sumOwedCents(txs);
  return {
    playerName,
    amount: Math.round((owedCents / 100) * 100) / 100,
    gamesOwed,
    streak,
  };
}

export async function getEventBalanceSummary(eventId: string): Promise<BalanceSummary> {
  if (!isWalletReadPathEnabled()) {
    return getEventBalanceSummaryLegacy(eventId);
  }
  // Find every EventPlayer in the event that has a userId (i.e. has a ledger).
  const eventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId, userId: { not: null } },
    select: { name: true, userId: true },
  });
  const balances: PlayerBalance[] = [];
  for (const ep of eventPlayers) {
    if (!ep.userId) continue;
    const txs = await getLedgerForEventPlayer(eventId, ep.userId, ep.name);
    const { owedCents, gamesOwed, streak } = sumOwedCents(txs);
    if (owedCents > 0 || gamesOwed > 0) {
      balances.push({
        playerName: ep.name,
        amount: Math.round((owedCents / 100) * 100) / 100,
        gamesOwed,
        streak,
      });
    }
  }
  // Latest-game aggregate (paid count, total count).
  const latestHistory = await prisma.gameHistory.findFirst({
    where: { eventId, status: { not: "cancelled" } },
    orderBy: { dateTime: "desc" },
    select: { id: true },
  });
  let paidCount = 0;
  let totalCount = 0;
  if (latestHistory) {
    const rows = await prisma.walletTransaction.findMany({
      where: { eventId, gameHistoryId: latestHistory.id, reason: { in: ["per_game_share", "payment_received"] } },
      select: { userId: true, direction: true, reason: true, amountCents: true },
    });
    // Aggregate per userId for this game
    const perUser = new Map<string, { debit: number; received: number }>();
    for (const r of rows) {
      const cur = perUser.get(r.userId) ?? { debit: 0, received: 0 };
      if (r.reason === "per_game_share" && r.direction === "debit") cur.debit += r.amountCents;
      if (r.reason === "payment_received" && r.direction === "credit") cur.received += r.amountCents;
      perUser.set(r.userId, cur);
    }
    for (const v of perUser.values()) {
      totalCount++;
      if (v.received >= v.debit) paidCount++;
    }
  } else {
    // No history yet — fall back to live ledger (current game).
    const liveRows = await prisma.walletTransaction.findMany({
      where: { eventId, reason: "per_game_share", gameHistoryId: null },
      select: { userId: true, direction: true, amountCents: true, reason: true },
    });
    const perUser = new Map<string, { debit: number; received: number }>();
    for (const r of liveRows) {
      const cur = perUser.get(r.userId) ?? { debit: 0, received: 0 };
      if (r.direction === "debit") cur.debit += r.amountCents;
      perUser.set(r.userId, cur);
    }
    for (const v of perUser.values()) {
      totalCount++;
      if (v.received >= v.debit) paidCount++;
    }
  }
  return { paidCount, totalCount, balances };
}

export async function getGateBalance(
  eventId: string,
  playerName: string,
): Promise<number> {
  if (!isWalletReadPathEnabled()) {
    return getGateBalanceLegacy(eventId, playerName);
  }
  const userId = await resolveEventPlayerUserId(eventId, playerName);
  if (!userId) return 0;
  const txs = await getLedgerForEventPlayer(eventId, userId, playerName);
  // Gate: only count "still owed" amounts (debits with no payment_received).
  // payment_self_reported does NOT clear the gate (per CONTEXT.md hard_gate
  // semantics, but we apply it uniformly across levels for safety).
  const perGame = new Map<string, { debit: number; received: number }>();
  for (const tx of txs) {
    const key = tx.gameHistoryId ?? "_live_";
    const cur = perGame.get(key) ?? { debit: 0, received: 0 };
    if (tx.reason === "per_game_share" && tx.direction === "debit") cur.debit += tx.amountCents;
    if (tx.reason === "payment_received" && tx.direction === "credit") cur.received += tx.amountCents;
    perGame.set(key, cur);
  }
  let amountCents = 0;
  for (const g of perGame.values()) {
    if (g.debit > g.received) amountCents += g.debit - g.received;
  }
  return Math.round((amountCents / 100) * 100) / 100;
}
