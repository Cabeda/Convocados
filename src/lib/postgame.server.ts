import { prisma } from "./db.server";
import { isGameEnded } from "./gameStatus";
import { getSession, checkOwnership } from "./auth.helpers.server";
import { MVP_VOTING_WINDOW_DAYS } from "./mvp.constants";
import { isSettledGameParticipant } from "./participants.server";
import { isHistoryParticipant } from "./snapshotParticipants";
import { getWrapUpGameSettlement } from "./settlement.server";

/**
 * Shared post-game wrap-up status computation.
 *
 * Consumed by:
 * - GET /api/events/:id/post-game-status (dedicated endpoint, polled live)
 * - GET /api/events/:id (embedded as `postGameStatus` so the UI can decide
 *   whether to render the post-game banner from the initial page payload
 *   instead of flashing it and hiding it after the client fetch resolves)
 */
export interface PostGameStatusPayload {
  gameEnded: boolean;
  hasScore: boolean;
  hasCost: boolean;
  allPaid: boolean;
  allComplete: boolean;
  isParticipant: boolean;
  isPlayer: boolean;
  latestHistoryId: string | null;
  paymentsSnapshot: Array<{ playerName: string; amount: number; status: string; method?: string | null }> | null;
  costCurrency: string | null;
  costAmount: number | null;
  hasPendingPastPayments: boolean;
  mvpEnabled: boolean;
  mvpComplete: boolean;
  bannerMvpComplete: boolean;
  myMvpComplete: boolean;
  paidAggregate: { paidCount: number; totalCount: number };
  scoreOne: number | null;
  scoreTwo: number | null;
  teamOneName: string;
  teamTwoName: string;
  gamePayments: Array<{ eventPlayerId: string; name: string; amount: number; status: string; isPayer: boolean }> | null;
  gameConfig: { gameId: string; mode: "tracked" | "untracked"; payerName: string | null; payerIsPlayer: boolean } | null;
}

export async function computePostGameStatus(
  eventId: string,
  request: Request,
): Promise<PostGameStatusPayload | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, dateTime: true, durationMinutes: true, ownerId: true, mvpEnabled: true, teamOneName: true, teamTwoName: true },
  });

  if (!event) return null;

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
    return {
      gameEnded: false, hasScore: false, hasCost: false, allPaid: true,
      allComplete: true, isParticipant: false, isPlayer: false, latestHistoryId: null,
      paymentsSnapshot: null, costCurrency: null, costAmount: null,
      hasPendingPastPayments: false, mvpEnabled: false, mvpComplete: true,
      bannerMvpComplete: true, myMvpComplete: true, paidAggregate: { paidCount: 0, totalCount: 0 },
      scoreOne: null, scoreTwo: null,
      teamOneName: event.teamOneName, teamTwoName: event.teamTwoName,
      gamePayments: null, gameConfig: null,
    };
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

  // ─── Session-dependent flags (needed before the MVP block below) ──────
  const session = await getSession(request);

  // Whether the current user actually PLAYED the settled game (players-only).
  // Unlike isParticipant, the Owner/Admin settlement override does NOT apply —
  // MVP voting is restricted to players, so an admin who didn't play must not
  // be offered the Vote MVP task nor have the banner held open by MVP state.
  const isPlayer = session?.user ? isHistoryParticipant(latestHistory, session.user.name) : false;

  // ─── MVP voting completion ──────────────────────────────────────────
  let mvpComplete = true;
  // ponytail: bannerMvpComplete uses a 24h window for banner dismissal only.
  // Full MVP voting stays open for MVP_VOTING_WINDOW_DAYS via the history page.
  let bannerMvpComplete = true;
  // The wrap-up checklist is personal: MY vote is the task, not everyone's.
  // A player who has cast their vote is done — the banner must disappear for
  // them even while other eligible voters haven't voted yet (they each keep
  // their own task). Non-players have no MVP task at all.
  let myMvpComplete = true;
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

      // Banner dismissal ceiling: all voted OR 24h since game ended
      bannerMvpComplete = mvpComplete || hoursSinceGameEnd >= 24;

      // Personal task: has THIS user voted?
      if (isPlayer && session?.user) {
        let viewerVoted: boolean;
        const userPlayers = await prisma.player.findMany({
          where: { eventId: event.id, userId: session.user.id },
          select: { id: true },
        });
        if (userPlayers.length > 0) {
          const existing = await prisma.mvpVote.findFirst({
            where: { gameHistoryId: latestHistory.id, voterPlayerId: { in: userPlayers.map((p) => p.id) } },
            select: { id: true },
          });
          viewerVoted = !!existing;
        } else {
          // Participant with no Player record — votes are stored name-based.
          const existing = await prisma.mvpVote.findFirst({
            where: { gameHistoryId: latestHistory.id, voterPlayerId: `name:${session.user.name}` },
            select: { id: true },
          });
          viewerVoted = !!existing;
        }
        // After 24h the banner stops nagging even without a vote (same
        // ceiling as bannerMvpComplete); voting itself stays open on history.
        myMvpComplete = viewerVoted || hoursSinceGameEnd >= 24;
      }
    }
    // If voting is not open (window expired or newer game), both stay true
  }

  // allComplete gates banner dismissal — score + payments + MY MVP vote.
  // Personal, not global: the checklist disappears for a user once THEIR
  // tasks are done; other voters keep their own banner (24h ceiling applies).
  let allComplete = hasScore && allPaid && myMvpComplete;

  // Payment overhaul: the durable per-game payment view for the wrap-up banner.
  // When present, the banner renders these rows and settles via the settlement API.
  const wrapUpSettlement = await getWrapUpGameSettlement(event.id);

  // Check if there are unsettled payments from a past game in history,
  // even when the current event hasn't ended yet (post-reset scenario).
  // This allows the banner to show for recurring events that have already
  // reset to the next occurrence but still have unpaid past game payments.
  // Untracked games ("each one pays their own share") are settled by
  // definition, so stale legacy snapshot rows must not count as pending.
  let hasPendingPastPayments = false;
  if (!gameEnded && latestHistory?.paymentsSnapshot && wrapUpSettlement?.mode !== "untracked") {
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
  let paymentsSnapshot: PostGameStatusPayload["paymentsSnapshot"] = null;
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

  // Check if the current user is a participant of the settled game.
  // Owner/Admin always count (settlement role: confirm payments, set score).
  // Otherwise use the shared settled-game participant check.
  let isParticipant = false;
  if (session?.user) {
    const ownership = await checkOwnership(request, event.ownerId, session, event.id);
    if (ownership?.isOwner || ownership?.isAdmin) {
      isParticipant = true;
    } else {
      isParticipant = await isSettledGameParticipant({
        sessionUser: session.user,
        event,
        latestHistory,
        pastGameSource,
        eventCost,
      });
    }
  }

  // Whether the current user actually PLAYED the settled game (players-only).
  // Unlike isParticipant, the Owner/Admin settlement override does NOT apply —
  // MVP voting is restricted to players, so an admin who didn't play must not
  // be offered the Vote MVP task nor have the banner held open by MVP state.
  // (Computed before the MVP block; kept here as the canonical definition.)

  // Compute aggregate payment info for social proof
  let paidAggregate = { paidCount: 0, totalCount: 0 };
  if (paymentsSnapshot && paymentsSnapshot.length > 0) {
    paidAggregate = {
      paidCount: paymentsSnapshot.filter((p) => p.status === "paid").length,
      totalCount: paymentsSnapshot.length,
    };
  }

  if (wrapUpSettlement) {
    hasCost = true;
    allPaid = wrapUpSettlement.rows.length === 0 || wrapUpSettlement.rows.every((r) => r.status === "paid");
    paidAggregate = {
      paidCount: wrapUpSettlement.rows.filter((r) => r.status === "paid").length,
      totalCount: wrapUpSettlement.rows.length,
    };
    // Recompute the wrap-up completion gate — allPaid may have flipped.
    allComplete = hasScore && allPaid && myMvpComplete;
  }

  return {
    gameEnded, hasScore, hasCost, allPaid, allComplete, isParticipant, isPlayer,
    latestHistoryId, paymentsSnapshot, costCurrency, costAmount,
    hasPendingPastPayments, mvpEnabled: event.mvpEnabled, mvpComplete, bannerMvpComplete,
    myMvpComplete,
    paidAggregate,
    scoreOne: latestHistory?.scoreOne ?? null,
    scoreTwo: latestHistory?.scoreTwo ?? null,
    teamOneName: event.teamOneName,
    teamTwoName: event.teamTwoName,
    gamePayments: wrapUpSettlement?.rows ?? null,
    gameConfig: wrapUpSettlement
      ? { gameId: wrapUpSettlement.gameId, mode: wrapUpSettlement.mode, payerName: wrapUpSettlement.payerName, payerIsPlayer: wrapUpSettlement.payerIsPlayer }
      : null,
  };
}
