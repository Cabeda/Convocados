/**
 * Legacy read path for Outstanding Balances (pre-ADR-0019).
 *
 * Kept in this file so the read path can be rolled back to the pre-migration
 * implementation by setting WALLET_READ_PATH_ENABLED=false. Do NOT write new
 * callers against this file; use `balance.server.ts` instead.
 *
 * The new read path is in `balance.server.ts` and reads from
 * `WalletTransaction` exclusively. The two implementations are golden-master
 * tested in `src/test/balance-ledger.test.ts`.
 */
import { prisma } from "./db.server";

export interface PlayerBalance {
  playerName: string;
  amount: number; // total owed (pending + sent)
  gamesOwed: number; // number of games with unpaid amounts
  streak: number; // consecutive games paid in a row (most recent first)
}

export interface BalanceSummary {
  paidCount: number;
  totalCount: number;
  balances: PlayerBalance[];
}

interface SnapshotEntry {
  playerName: string;
  amount: number;
  status: string;
}

export async function getOutstandingBalanceLegacy(
  eventId: string,
  playerName: string,
): Promise<PlayerBalance> {
  const [histories, eventCost] = await Promise.all([
    prisma.gameHistory.findMany({
      where: { eventId, status: { not: "cancelled" } },
      select: { paymentsSnapshot: true, dateTime: true },
      orderBy: { dateTime: "desc" },
    }),
    prisma.eventCost.findUnique({
      where: { eventId },
      include: { payments: { where: { playerName } } },
    }),
  ]);

  let amount = 0;
  let gamesOwed = 0;
  let streak = 0;
  let streakBroken = false;

  const timeline: { status: string; amt: number }[] = [];

  if (eventCost?.payments.length) {
    const live = eventCost.payments[0];
    timeline.push({ status: live.status, amt: live.amount });
  }

  for (const h of histories) {
    if (!h.paymentsSnapshot) continue;
    try {
      const entries: SnapshotEntry[] = JSON.parse(h.paymentsSnapshot);
      const entry = entries.find((e) => e.playerName === playerName);
      if (entry) timeline.push({ status: entry.status, amt: entry.amount });
    } catch { /* skip malformed */ }
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

export async function getEventBalanceSummaryLegacy(eventId: string): Promise<BalanceSummary> {
  const [histories, eventCost, settlements] = await Promise.all([
    prisma.gameHistory.findMany({
      where: { eventId, status: { not: "cancelled" } },
      select: { id: true, paymentsSnapshot: true, dateTime: true },
      orderBy: { dateTime: "desc" },
    }),
    prisma.eventCost.findUnique({
      where: { eventId },
      include: { payments: true },
    }),
    // Historical Settlements (ADR 0019) — a `payment_received` row with a
    // `gameHistoryId` is a written payment against a frozen snapshot entry.
    // Net them into the read view so the UI reflects the latest state even
    // though the snapshot itself is treated as immutable.
    prisma.walletTransaction.findMany({
      where: { eventId, reason: "payment_received", gameHistoryId: { not: null } },
      select: { gameHistoryId: true, playerName: true },
    }),
  ]);

  // Build a fast lookup: `${gameHistoryId}:${playerName}` → settled
  const settledKeys = new Set<string>();
  for (const s of settlements) {
    if (!s.gameHistoryId || !s.playerName) continue;
    settledKeys.add(`${s.gameHistoryId}:${s.playerName}`);
  }

  const debts = new Map<string, { amount: number; gamesOwed: number }>();

  for (const h of histories) {
    if (!h.paymentsSnapshot) continue;
    try {
      const entries: SnapshotEntry[] = JSON.parse(h.paymentsSnapshot);
      for (const e of entries) {
        if (e.status !== "pending" && e.status !== "sent") continue;
        // Skip snapshot entries that have been settled via a payment_received
        // wallet transaction. Without this net, settling a debt wouldn't
        // remove the row from the balance summary on the legacy read path.
        if (settledKeys.has(`${h.id}:${e.playerName}`)) continue;
        const d = debts.get(e.playerName) ?? { amount: 0, gamesOwed: 0 };
        d.amount += e.amount;
        d.gamesOwed++;
        debts.set(e.playerName, d);
      }
    } catch { /* skip */ }
  }

  if (eventCost) {
    for (const p of eventCost.payments) {
      if (p.status === "pending" || p.status === "sent") {
        const d = debts.get(p.playerName) ?? { amount: 0, gamesOwed: 0 };
        d.amount += p.amount;
        d.gamesOwed++;
        debts.set(p.playerName, d);
      }
    }
  }

  const balances: PlayerBalance[] = [...debts.entries()].map(([playerName, { amount, gamesOwed }]) => ({
    playerName,
    amount: Math.round(amount * 100) / 100,
    gamesOwed,
    streak: 0,
  }));

  let paidCount = 0;
  let totalCount = 0;
  const latest = histories[0];
  if (latest?.paymentsSnapshot) {
    try {
      const entries: SnapshotEntry[] = JSON.parse(latest.paymentsSnapshot);
      totalCount = entries.length;
      paidCount = entries.filter((e) => e.status === "paid").length;
    } catch { /* skip */ }
  } else if (eventCost) {
    totalCount = eventCost.payments.length;
    paidCount = eventCost.payments.filter((p) => p.status === "paid").length;
  }

  return { paidCount, totalCount, balances };
}

export async function getGateBalanceLegacy(
  eventId: string,
  playerName: string,
): Promise<number> {
  const [histories, eventCost] = await Promise.all([
    prisma.gameHistory.findMany({
      where: { eventId, status: { not: "cancelled" } },
      select: { paymentsSnapshot: true },
    }),
    prisma.eventCost.findUnique({
      where: { eventId },
      include: { payments: { where: { playerName } } },
    }),
  ]);

  let amount = 0;

  for (const h of histories) {
    if (!h.paymentsSnapshot) continue;
    try {
      const entries: Array<{ playerName: string; amount: number; status: string }> = JSON.parse(h.paymentsSnapshot);
      const entry = entries.find((e) => e.playerName === playerName);
      if (entry && entry.status === "pending") {
        amount += entry.amount;
      }
    } catch { /* skip */ }
  }

  if (eventCost?.payments.length) {
    const live = eventCost.payments[0];
    if (live.status === "pending") {
      amount += live.amount;
    }
  }

  return Math.round(amount * 100) / 100;
}
