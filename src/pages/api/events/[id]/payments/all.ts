import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { isWalletReadPathEnabled } from "~/lib/featureFlag.server";

/**
 * GET /api/events/[id]/payments/all
 *
 * Returns the per-player × per-game payment matrix for the whole event,
 * modelled after settleup.app's activity list. Owner/Admin only.
 *
 * Cell shape:
 *   { status: "paid" | "sent" | "pending" | "absent",
 *     amountCents: number,
 *     gameHistoryId: string,
 *     settled: boolean,         // true if a payment_received Historical Settlement exists
 *     settledAt: string | null  // ISO of the settlement, if any
 *   }
 *
 * Reads from the ledger when WALLET_READ_PATH_ENABLED=true (the post-ADR-0019
 * source of truth), otherwise falls back to the legacy snapshot.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const useLedger = isWalletReadPathEnabled();
  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });

  // Collect all EventPlayer names (deduped, sorted)
  const eventPlayers = await prisma.eventPlayer.findMany({
    where: { eventId },
    select: { name: true, userId: true },
    orderBy: { name: "asc" },
  });
  const playerNames = [...new Set(eventPlayers.map((p) => p.name))].sort();

  // Collect all played games (not cancelled) ordered most-recent first
  const histories = await prisma.gameHistory.findMany({
    where: { eventId, status: { not: "cancelled" } },
    select: { id: true, dateTime: true, paymentsSnapshot: true, teamsSnapshot: true },
    orderBy: { dateTime: "desc" },
  });

  interface MatrixCell {
    status: "paid" | "sent" | "pending" | "absent";
    amountCents: number;
    gameHistoryId: string;
    settled: boolean;
    settledAt: string | null;
  }

  // If using ledger, fetch the relevant settlement rows in one query
  const settlementsByGameAndUser = new Map<string, { amountCents: number; createdAt: Date }>();
  if (useLedger) {
    const userIds = eventPlayers.map((p) => p.userId).filter((u): u is string => !!u);
    if (userIds.length > 0 && histories.length > 0) {
      const settlements = await prisma.walletTransaction.findMany({
        where: {
          eventId,
          reason: "payment_received",
          gameHistoryId: { in: histories.map((h) => h.id) },
          userId: { in: userIds },
        },
        select: { gameHistoryId: true, userId: true, amountCents: true, createdAt: true },
      });
      for (const s of settlements) {
        if (!s.gameHistoryId) continue;
        const key = `${s.gameHistoryId}:${s.userId}`;
        settlementsByGameAndUser.set(key, { amountCents: s.amountCents, createdAt: s.createdAt });
      }
    }
  }

  const userIdByName = new Map(eventPlayers.map((p) => [p.name, p.userId]));

  const games = histories.map((h) => {
    const cells: Record<string, MatrixCell> = {};
    let snapshot: Array<{ playerName: string; amount: number; status: string }> = [];
    if (h.paymentsSnapshot) {
      try {
        snapshot = JSON.parse(h.paymentsSnapshot);
      } catch {
        snapshot = [];
      }
    }
    const teams: Array<{ team: string; players: Array<{ name: string }> }> = h.teamsSnapshot
      ? (() => { try { return JSON.parse(h.teamsSnapshot!); } catch { return []; } })()
      : [];
    const participants = new Set(teams.flatMap((t) => t.players.map((p) => p.name)));

    for (const name of playerNames) {
      const entry = snapshot.find((e) => e.playerName === name);
      if (!entry && !participants.has(name)) {
        cells[name] = { status: "absent", amountCents: 0, gameHistoryId: h.id, settled: false, settledAt: null };
        continue;
      }
      const userId = userIdByName.get(name);
      const settlement = userId ? settlementsByGameAndUser.get(`${h.id}:${userId}`) : undefined;
      const amountCents = Math.round((entry?.amount ?? 0) * 100);
      const status = (entry?.status as MatrixCell["status"]) ?? "absent";
      cells[name] = {
        status,
        amountCents,
        gameHistoryId: h.id,
        settled: !!settlement || status === "paid",
        settledAt: settlement?.createdAt.toISOString() ?? null,
      };
    }
    return {
      gameHistoryId: h.id,
      dateTime: h.dateTime.toISOString(),
      totalAmount: eventCost?.totalAmount ?? 0,
      currency: eventCost?.currency ?? "EUR",
      cells,
    };
  });

  return Response.json({
    source: useLedger ? "ledger" : "legacy",
    event: { id: event.id, title: event.title, currency: eventCost?.currency ?? "EUR" },
    players: playerNames,
    games,
  });
};
