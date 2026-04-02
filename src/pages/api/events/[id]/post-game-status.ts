import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { isGameEnded } from "../../../../lib/gameStatus";
import { getSession } from "../../../../lib/auth.helpers.server";

/**
 * GET /api/events/:id/post-game-status
 *
 * Returns the post-game completion status for an event:
 * - gameEnded: whether dateTime + durationMinutes is in the past
 * - hasScore: whether the most recent GameHistory has scoreOne/scoreTwo set
 * - hasCost: whether an EventCost record exists with totalAmount > 0
 * - allPaid: whether all payments are paid (or no cost set)
 * - allComplete: hasScore && allPaid
 * - isParticipant: whether the current user is a participant (name match or claimed spot)
 */
export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, dateTime: true, durationMinutes: true, ownerId: true },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const gameEnded = isGameEnded(event.dateTime, event.durationMinutes);

  // Check if the most recent game history has a score recorded
  const latestHistory = await prisma.gameHistory.findFirst({
    where: { eventId: event.id },
    orderBy: { dateTime: "desc" },
    select: { id: true, scoreOne: true, scoreTwo: true, teamsSnapshot: true, paymentsSnapshot: true },
  });
  const hasScore = !!(latestHistory && latestHistory.scoreOne !== null && latestHistory.scoreTwo !== null);

  // Check payment status — look at live payments first, then fall back to
  // the latest history snapshot (covers the case where a recurrence reset
  // cleared the live payments but the previous game still has unpaid items).
  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId: event.id },
    include: { payments: { select: { status: true, playerName: true, amount: true, method: true } } },
  });

  const hasCost = !!(eventCost && eventCost.totalAmount > 0) || !!(latestHistory?.paymentsSnapshot);

  // Determine allPaid for the PAST game.
  // The banner is about settling the past game, so we must check the history
  // snapshot first (it represents the past game's payments after recurrence
  // reset). Only fall back to live payments when no snapshot exists yet
  // (game ended but hasn't reset — live payments ARE the past game).
  let allPaid = true;
  let pastGameSource: "snapshot" | "live" | "none" = "none";

  if (latestHistory?.paymentsSnapshot) {
    // History snapshot exists — this is the authoritative source for the past game
    pastGameSource = "snapshot";
    try {
      const snapshot = JSON.parse(latestHistory.paymentsSnapshot) as Array<{ status: string }>;
      if (snapshot.length > 0) {
        allPaid = snapshot.every(
          (p) => p.status === "paid",
        );
      }
    } catch { /* ignore parse errors */ }
  } else if (eventCost && eventCost.payments.length > 0) {
    // No snapshot yet — live payments are still the past game's payments
    // (game ended but recurrence hasn't reset yet)
    pastGameSource = "live";
    allPaid = eventCost.payments.every(
      (p) => p.status === "paid",
    );
  }

  const allComplete = hasScore && allPaid;

  // Check if there are unsettled payments from a past game in history,
  // even when the current event hasn't ended yet (post-reset scenario).
  // This allows the banner to show for recurring events that have already
  // reset to the next occurrence but still have unpaid past game payments.
  let hasPendingPastPayments = false;
  if (!gameEnded && latestHistory?.paymentsSnapshot) {
    try {
      const snapshot = JSON.parse(latestHistory.paymentsSnapshot) as Array<{ status: string }>;
      if (snapshot.length > 0) {
        hasPendingPastPayments = !snapshot.every(
          (p) => p.status === "paid",
        );
      }
    } catch { /* ignore */ }
  }

  // Build paymentsSnapshot for the banner to render inline.
  // Must match the same source used for allPaid above.
  let paymentsSnapshot: Array<{ playerName: string; amount: number; status: string; method?: string | null }> | null = null;
  let latestHistoryId: string | null = null;
  let costCurrency: string | null = null;
  let costAmount: number | null = null;

  if (eventCost) {
    costCurrency = eventCost.currency;
    costAmount = eventCost.totalAmount;
  }

  if (latestHistory) {
    latestHistoryId = latestHistory.id;
  }

  if (pastGameSource === "snapshot" && latestHistory?.paymentsSnapshot) {
    try {
      paymentsSnapshot = JSON.parse(latestHistory.paymentsSnapshot);
    } catch { /* ignore */ }
  } else if (pastGameSource === "live" && eventCost && eventCost.payments.length > 0) {
    paymentsSnapshot = eventCost.payments.map((p) => ({
      playerName: p.playerName,
      amount: p.amount,
      status: p.status,
      method: p.method,
    }));
  }

  // Check if the current user is a participant
  let isParticipant = false;
  const session = await getSession(request);
  if (session?.user) {
    // Owner/admin is always a participant
    if (event.ownerId && session.user.id === event.ownerId) {
      isParticipant = true;
    }

    // Check name match against latest history teamsSnapshot
    if (!isParticipant && latestHistory?.teamsSnapshot && session.user.name) {
      try {
        const teams = JSON.parse(latestHistory.teamsSnapshot) as Array<{ players: Array<{ name: string }> }>;
        const allNames = teams.flatMap((t) => t.players.map((p) => p.name.toLowerCase()));
        isParticipant = allNames.includes(session.user.name.toLowerCase());
      } catch { /* ignore */ }
    }

    // Check claimed player spot
    if (!isParticipant) {
      const claimed = await prisma.player.findFirst({
        where: { eventId: params.id, userId: session.user.id, archivedAt: null },
      });
      if (claimed) isParticipant = true;
    }
  }

  return Response.json({
    gameEnded, hasScore, hasCost, allPaid, allComplete, isParticipant,
    latestHistoryId, paymentsSnapshot, costCurrency, costAmount,
    hasPendingPastPayments,
  });
};
