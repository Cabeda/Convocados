import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { isGameEnded } from "../../../../lib/gameStatus";
import { getSession } from "../../../../lib/auth.helpers.server";
import { MVP_VOTING_WINDOW_DAYS } from "../../../../lib/mvp.constants";

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
    select: { id: true, dateTime: true, durationMinutes: true, ownerId: true, mvpEnabled: true, teamOneName: true, teamTwoName: true },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const gameEnded = isGameEnded(event.dateTime, event.durationMinutes);

  // Check if the most recent game history has a score recorded
  const latestHistory = await prisma.gameHistory.findFirst({
    where: { eventId: event.id },
    orderBy: { dateTime: "desc" },
    select: { id: true, scoreOne: true, scoreTwo: true, teamsSnapshot: true, paymentsSnapshot: true, status: true, dateTime: true, createdAt: true },
  });

  // ponytail: cancelled games have no post-game actions (no score, no payments, no MVP).
  // Suppress the banner entirely when the most recent history is "cancelled".
  if (latestHistory?.status === "cancelled") {
    return Response.json({
      gameEnded: false, hasScore: false, hasCost: false, allPaid: true,
      allComplete: true, isParticipant: false, latestHistoryId: null,
      paymentsSnapshot: null, costCurrency: null, costAmount: null,
      hasPendingPastPayments: false, mvpEnabled: false, mvpComplete: true,
      bannerMvpComplete: true, paidAggregate: { paidCount: 0, totalCount: 0 },
      scoreOne: null, scoreTwo: null,
      teamOneName: event.teamOneName, teamTwoName: event.teamTwoName,
    });
  }
  const hasScore = !!(latestHistory && latestHistory.scoreOne !== null && latestHistory.scoreTwo !== null);

  // Check payment status — look at live payments first, then fall back to
  // the latest history snapshot (covers the case where a recurrence reset
  // cleared the live payments but the previous game still has unpaid items).
  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId: event.id },
    include: { payments: { select: { status: true, playerName: true, amount: true, method: true } } },
  });

  // Determine hasCost and allPaid for the PAST game.
  // The banner is about settling the past game. When a history entry exists,
  // its paymentsSnapshot is the authoritative source. Live payments may belong
  // to the NEXT game (after recurrence reset re-created costs for new players),
  // so we only fall back to live payments when either:
  //  a) No history entry exists yet (game ended but hasn't reset)
  //  b) History exists without snapshot BUT the game hasn't reset yet
  //     (history.dateTime matches event.dateTime — same game)
  let hasCost: boolean;
  let allPaid = true;
  let pastGameSource: "snapshot" | "live" | "none" = "none";

  // Detect whether a recurrence reset has moved the event forward.
  // If latestHistory.dateTime < event.dateTime, the event moved to a new occurrence
  // and live payments belong to the new game, not the past one.
  const hasResetOccurred = latestHistory
    && event.dateTime.getTime() > latestHistory.dateTime.getTime();

  if (latestHistory?.paymentsSnapshot) {
    // History snapshot exists — this is the authoritative source for the past game
    pastGameSource = "snapshot";
    hasCost = true;
    try {
      const snapshot = JSON.parse(latestHistory.paymentsSnapshot) as Array<{ status: string }>;
      if (snapshot.length > 0) {
        allPaid = snapshot.every(
          (p) => p.status === "paid",
        );
      }
    } catch { /* ignore parse errors */ }
  } else if (eventCost && eventCost.totalAmount > 0 && !hasResetOccurred) {
    // No snapshot AND game hasn't reset yet — live payments are the past game's
    pastGameSource = "live";
    hasCost = true;
    if (eventCost.payments.length > 0) {
      allPaid = eventCost.payments.every(
        (p) => p.status === "paid",
      );
    }
  } else {
    // Either: no cost at all, OR history exists post-reset with no snapshot
    // (past game had no cost). Live payments belong to the NEW game — don't use.
    hasCost = false;
  }

  // ─── MVP voting completion ──────────────────────────────────────────
  let mvpComplete = true;
  // ponytail: bannerMvpComplete uses a 24h window for banner dismissal only.
  // Full MVP voting stays open for MVP_VOTING_WINDOW_DAYS via the history page.
  let bannerMvpComplete = true;
  if (event.mvpEnabled && latestHistory && latestHistory.status === "played") {
    // Determine if voting window is still open
    const gameEndTime = new Date(latestHistory.dateTime.getTime() + (event.durationMinutes ?? 60) * 60_000);
    const gameHasEnded = gameEndTime <= new Date();
    const hoursSinceGameEnd = (Date.now() - gameEndTime.getTime()) / 3_600_000;
    const daysSinceCreation = (Date.now() - latestHistory.createdAt.getTime()) / 86400_000;
    const withinWindow = daysSinceCreation <= MVP_VOTING_WINDOW_DAYS;

    // Check if a newer game exists (closes voting for this one)
    const newerGame = await prisma.gameHistory.findFirst({
      where: { eventId: event.id, dateTime: { gt: latestHistory.dateTime }, status: "played" },
      select: { id: true },
    });

    const isVotingOpen = gameHasEnded && !newerGame && withinWindow;

    if (isVotingOpen) {
      // Count eligible voters: participants in teamsSnapshot that have user accounts
      let eligibleCount = 0;
      if (latestHistory.teamsSnapshot) {
        try {
          const teams = JSON.parse(latestHistory.teamsSnapshot) as Array<{ players: Array<{ name: string }> }>;
          const allNames = teams.flatMap((t) => t.players.map((p) => p.name));
          // Find users whose names match participants (case-insensitive)
          const matchingUsers = await prisma.user.findMany({
            where: { name: { in: allNames } },
            select: { name: true },
          });
          eligibleCount = matchingUsers.length;
        } catch { /* ignore */ }
      }

      if (eligibleCount > 0) {
        // Count votes already cast for this game
        const voteCount = await prisma.mvpVote.count({
          where: { gameHistoryId: latestHistory.id },
        });
        mvpComplete = voteCount >= eligibleCount;
      }
      // If no eligible voters (no users matched), consider MVP complete

      // Banner dismissal: all voted OR 24h since game ended
      bannerMvpComplete = mvpComplete || hoursSinceGameEnd >= 24;
    }
    // If voting is not open (window expired or newer game), bannerMvpComplete stays true
  }

  // ponytail: allComplete gates banner dismissal — score + payments + MVP (24h ceiling).
  // After 24h the banner hides even if not everyone voted; voting stays open on history page.
  const allComplete = hasScore && allPaid && bannerMvpComplete;

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

  // Compute aggregate payment info for social proof
  let paidAggregate = { paidCount: 0, totalCount: 0 };
  if (paymentsSnapshot && paymentsSnapshot.length > 0) {
    paidAggregate = {
      paidCount: paymentsSnapshot.filter((p) => p.status === "paid").length,
      totalCount: paymentsSnapshot.length,
    };
  }

  return Response.json({
    gameEnded, hasScore, hasCost, allPaid, allComplete, isParticipant,
    latestHistoryId, paymentsSnapshot, costCurrency, costAmount,
    hasPendingPastPayments, mvpEnabled: event.mvpEnabled, mvpComplete, bannerMvpComplete,
    paidAggregate,
    scoreOne: latestHistory?.scoreOne ?? null,
    scoreTwo: latestHistory?.scoreTwo ?? null,
    teamOneName: event.teamOneName,
    teamTwoName: event.teamTwoName,
  });
};
