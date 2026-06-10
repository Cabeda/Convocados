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

/**
 * Compute the outstanding balance for a single player within an event.
 * Sums unpaid (pending/sent) from history snapshots + live PlayerPayment.
 * Cancelled histories are excluded.
 */
export async function getOutstandingBalance(
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

  // Build ordered list: live game (newest) then history entries (desc)
  type GameEntry = { status: string; amt: number };
  const timeline: GameEntry[] = [];

  // Live game first (it's the current/newest)
  if (eventCost?.payments.length) {
    const live = eventCost.payments[0];
    timeline.push({ status: live.status, amt: live.amount });
  }

  // History entries (already desc by dateTime)
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

/**
 * Compute balances for all players + aggregate for latest game.
 */
export async function getEventBalanceSummary(eventId: string): Promise<BalanceSummary> {
  const [histories, eventCost] = await Promise.all([
    prisma.gameHistory.findMany({
      where: { eventId, status: { not: "cancelled" } },
      select: { paymentsSnapshot: true, dateTime: true },
      orderBy: { dateTime: "desc" },
    }),
    prisma.eventCost.findUnique({
      where: { eventId },
      include: { payments: true },
    }),
  ]);

  // Accumulate debts per player
  const debts = new Map<string, { amount: number; gamesOwed: number }>();

  for (const h of histories) {
    if (!h.paymentsSnapshot) continue;
    try {
      const entries: SnapshotEntry[] = JSON.parse(h.paymentsSnapshot);
      for (const e of entries) {
        if (e.status === "pending" || e.status === "sent") {
          const d = debts.get(e.playerName) ?? { amount: 0, gamesOwed: 0 };
          d.amount += e.amount;
          d.gamesOwed++;
          debts.set(e.playerName, d);
        }
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
    streak: 0, // computed on-demand per player via getOutstandingBalance
  }));

  // Aggregate for latest game
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

/**
 * Compute the "gate-blocking" balance for enforcement — only pending amounts
 * count toward gating, since `sent` clears the gate per ADR 0006.
 */
export async function getGateBalance(
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
