import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../../lib/auth.helpers.server";

/**
 * Unified transaction shape returned by this endpoint. The SettleUp page
 * renders these as a single chronological list. The shape is intentionally
 * flat so the UI doesn't need to know which underlying table each row
 * came from.
 */
export interface UnifiedTransaction {
  id: string;
  date: string; // ISO
  type: "game" | "subscription" | "spend" | "settlement";
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  /** For game payments: who owes/paid. For subscriptions: the subscriber. For spends: the declarer. For settlements: the debtor. */
  playerName?: string;
  /** For game transactions: array of all player names in the game. */
  gamePlayers?: string[];
  /** For game transactions: the GameHistory ID this transaction belongs to. */
  gameHistoryId?: string;
  /** For spend transactions: the category of the extras spend. */
  category?: string;
  /** For spend transactions: the allocation mode and shares. */
  allocation?: { mode: string; shares?: Record<string, number> };
}

/**
 * GET /api/events/[id]/settle/transactions
 *
 * Returns the transactions for the SettleUp page. Two view modes:
 *
 *   - Owner/Admin: unified event view = per-game payments (live +
 *     historical) + monthly subscriptions + organizer-declared spends.
 *   - Regular player: their own WalletTransaction ledger (legacy).
 *
 * Query params (only for the unified view):
 *   type  — filter to one of "game" | "subscription" | "spend" | "settlement"
 *   from  — ISO date; only entries with date >= from
 *   to    — ISO date; only entries with date <= to
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true, eventCost: { select: { currency: true } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  const isPrivileged = isOwner || isAdmin;

  // Per-user view (legacy): only the caller's own wallet transactions.
  if (!isPrivileged) {
    const url = new URL(request.url);
    const reasonParam = url.searchParams.get("reason");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const txs = await prisma.walletTransaction.findMany({
      where: {
        eventId,
        userId: session.user.id,
        ...(reasonParam ? { reason: reasonParam } : {}),
        ...(fromParam ? { createdAt: { gte: new Date(fromParam) } } : {}),
        ...(toParam ? { createdAt: { lte: new Date(toParam) } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({
      transactions: txs.map((t) => ({
        id: t.id,
        userId: t.userId,
        reason: t.reason,
        direction: t.direction,
        amountCents: t.amountCents,
        currency: t.currency,
        gameUnits: t.gameUnits,
        statusAfter: t.statusAfter,
        eventInstanceId: t.eventInstanceId,
        subscriptionId: t.subscriptionId,
        extrasId: t.extrasId,
        markedById: t.markedById,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  }

  // ── Unified event view (owner/admin) ──────────────────────────────────
  const url = new URL(request.url);
  const typeFilter = url.searchParams.get("type");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const fromDate = fromParam ? new Date(fromParam) : null;
  const toDate = toParam ? new Date(toParam) : null;
  const include = (t: "game" | "subscription" | "spend" | "settlement") =>
    !typeFilter || typeFilter === t;

  const result: UnifiedTransaction[] = [];
  const currency = event.eventCost?.currency ?? "EUR";

  // 1. Live per-game payments (PlayerPayment rows on EventCost).
  // These don't have a GameHistory entry yet — they belong to the "current" game.
  if (include("game")) {
    const livePayments = await prisma.playerPayment.findMany({
      where: { eventCost: { eventId } },
      include: { eventCost: { select: { currency: true } } },
    });
    if (livePayments.length > 0) {
      // Group live payments: one entry for the current game
      const totalAmount = livePayments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
      const allPlayerNames = [...new Set(livePayments.map(p => p.playerName))];
      const allPaid = livePayments.every(p => p.status === "paid");
      const anyPending = livePayments.some(p => p.status === "pending" || p.status === "sent");
      const status = allPaid ? "paid" : (anyPending ? "pending" : "sent");

      result.push({
        id: `live-game-${eventId}`,
        date: new Date().toISOString(), // current game
        type: "game",
        description: `Game payment — ${livePayments[0].eventCost.currency}`,
        amountCents: totalAmount,
        currency: livePayments[0].eventCost.currency,
        status: anyPending ? "pending" : (allPaid ? "paid" : "sent"),
        gamePlayers: [...new Set(livePayments.map(p => p.playerName))],
        playerName: "multiple",
      });
    }

    // Historical per-game payments (GameHistory.paymentsSnapshot).
    // One entry per GameHistory (one per game played).
    const histories = await prisma.gameHistory.findMany({
      where: { eventId, status: { not: "cancelled" } },
      select: { id: true, dateTime: true, paymentsSnapshot: true, teamsSnapshot: true },
      orderBy: { dateTime: "desc" },
    });

    for (const h of histories) {
      if (!h.paymentsSnapshot) continue;
      let paymentEntries: Array<{ playerName: string; amount: number; status: string }>;
      try {
        paymentEntries = JSON.parse(h.paymentsSnapshot);
      } catch {
        continue;
      }

      // Get all players from teamsSnapshot (includes those who didn't pay yet)
      let entries: Array<{ playerName: string; amount: number; status: string }>;
      try {
        entries = JSON.parse(h.paymentsSnapshot) as Array<{ playerName: string; amount: number; status: string }>;
      } catch {
        continue;
      }

      // Get all players from teamsSnapshot (includes those who didn't pay yet)
      let allPlayers: string[] = [];
      if (h.teamsSnapshot) {
        try {
          const teams = JSON.parse(h.teamsSnapshot) as Array<{ players: Array<{ name: string }> }>;
          const teamPlayers = teams.flatMap(t => t.players.map(p => p.name));
          allPlayers = [...new Set(teamPlayers)];
        } catch {
          // fallback to paymentsSnapshot players
          allPlayers = [...new Set(entries.map(e => e.playerName))];
        }
      } else {
        allPlayers = [...new Set(entries.map(e => e.playerName))];
      }

      // Also include any players from paymentsSnapshot who aren't in teamsSnapshot
      const paymentPlayers = entries.map(e => e.playerName);
      const allPlayerNames = [...new Set([...allPlayers, ...paymentPlayers])];

      const totalAmount = entries.reduce((sum, e) => sum + Math.round(e.amount * 100), 0);
      const allPaid = entries.every(e => e.status === "paid");
      const anyPending = entries.some(e => e.status === "pending" || e.status === "sent");
      const status = allPaid ? "paid" : (entries.some(e => e.status === "pending" || e.status === "sent") ? "pending" : "sent");

      result.push({
        id: `game-${h.id}`,
        date: h.dateTime.toISOString(),
        type: "game",
        description: `Game — ${currency}`,
        amountCents: Math.round(entries.reduce((sum, e) => sum + e.amount * 100, 0)),
        currency, // use event currency
        status: entries.every(e => e.status === "paid") ? "paid" : (entries.some(e => e.status === "pending" || e.status === "sent") ? "pending" : "sent"),
        gamePlayers: allPlayerNames,
        playerName: "multiple",
        gameHistoryId: h.id,
      });
    }
  }

  // 2. Monthly subscriptions.
  if (include("subscription")) {
    const subs = await prisma.monthlySubscription.findMany({
      where: { eventId },
      include: { user: { select: { name: true } } },
      orderBy: { windowStart: "desc" },
    });
    for (const s of subs) {
      result.push({
        id: `sub-${s.id}`,
        date: s.windowStart.toISOString(),
        type: "subscription",
        description: `${s.user.name} — monthly subscription`,
        amountCents: s.feeCents,
        currency,
        status: s.status,
        playerName: s.user.name,
      });
    }
  }

  // 3. One-off organizer spends.
  if (include("spend")) {
    const spends = await prisma.extrasDeclaration.findMany({
      where: { eventId },
      include: { event: { include: { eventCost: { select: { currency: true } } } } },
      orderBy: { declaredAt: "desc" },
    });
    for (const s of spends) {
      result.push({
        id: `spend-${s.id}`,
        date: s.declaredAt.toISOString(),
        type: "spend",
        description: s.label,
        amountCents: s.amountCents,
        currency: s.currency,
        status: "paid",
        category: s.category,
        allocation: s.allocation as { mode: string; shares?: Record<string, number> } | undefined,
      });
    }
  }

  // 4. Debt settlements — every `payment_received` WalletTransaction row
  // is a historical debt being marked as paid. These surface in the
  // Transactions tab so the organizer can audit who paid what, when.
  if (!typeFilter || typeFilter === "settlement") {
    const settlements = await prisma.walletTransaction.findMany({
      where: { eventId, reason: "payment_received" },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    for (const s of settlements) {
      const debtorName = s.playerName ?? s.user?.name ?? s.userId;
      result.push({
        id: `settle-${s.id}`,
        date: s.createdAt.toISOString(),
        type: "settlement",
        description: `${debtorName} — debt payment`,
        amountCents: s.amountCents,
        currency: s.currency,
        status: "paid",
        playerName: debtorName,
      });
    }
  }

  // Date filter + sort.
  const filtered = result.filter((tx) => {
    const d = new Date(tx.date);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  return Response.json({ transactions: filtered });
};