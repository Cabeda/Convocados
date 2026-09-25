import { prisma } from "./db.server";
import { isGameEnded } from "./gameStatus";
import { getSession, checkOwnership } from "./auth.helpers.server";
import { MVP_VOTING_WINDOW_DAYS } from "./mvp.constants";
import { isSettledGameParticipant } from "./participants.server";
import { isHistoryParticipant } from "./snapshotParticipants";
import { getWrapUpGameSettlement } from "./settlement.server";
import { occurrencePaymentRoll } from "./paymentRoll.server";
import { getViewerGameRank, getViewerRankStanding, type ViewerGameRank, type ViewerRankStanding } from "./seasonRank.server";
import { summarizePayments } from "./paymentSummary";

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
  /** The viewer's Season Rank movement from this Game, when it counted. */
  seasonRank: ViewerGameRank | null;
  /**
   * The viewer's current Rank Standing in the Season covering this Game —
   * present even before the score is entered, so the banner can show the Rank
   * (and invite the score) instead of an empty section.
   */
  rankStanding: ViewerRankStanding | null;
  /**
   * True when the viewer is a debtor whose own share is already settled and who
   * is neither the receiver nor a settlement admin — the payment task is then
   * hidden for them, while the receiver/admin keep it open until everyone paid.
   */
  viewerPaymentSettled: boolean;
  /** Whether the Event already recurs — drives the post-game "make it recurring" prompt. */
  isRecurring: boolean;
}

export async function computePostGameStatus(
  eventId: string,
  request: Request,
): Promise<PostGameStatusPayload | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, dateTime: true, durationMinutes: true, ownerId: true, mvpEnabled: true, teamOneName: true, teamTwoName: true, currentGameId: true, isRecurring: true },
  });

  if (!event) return null;

  const gameEnded = isGameEnded(event.dateTime, event.durationMinutes);

  // Check if the most recent game history has a score recorded
  const latestHistory = await prisma.gameHistory.findFirst({
    where: { eventId: event.id },
    orderBy: { dateTime: "desc" },
    select: { id: true, scoreOne: true, scoreTwo: true, teamsSnapshot: true, paymentsSnapshot: true, status: true, dateTime: true, createdAt: true, isFriendly: true },
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
      gamePayments: null, gameConfig: null, seasonRank: null,
      rankStanding: null, viewerPaymentSettled: false,
      isRecurring: event.isRecurring ?? false,
    };
  }
  const hasScore = !!(latestHistory && latestHistory.scoreOne !== null && latestHistory.scoreTwo !== null);

  // Check payment status — the occurrence Game's GamePayment roll is the
  // durable source (ADR 0016). The frozen paymentsSnapshot is only residue
  // read when no Game exists for the occurrence.
  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId: event.id },
    select: { totalAmount: true, currency: true },
  });

  // Resolve the payment roll for the past game. When the event has NOT reset
  // (history dateTime == event dateTime), the past occurrence is the live
  // currentGameId — its Game.dateTime can drift from Event.dateTime after a
  // datetime edit. After a reset, the past occurrence is the game matching the
  // latest history's dateTime.
  const occurrenceDt = latestHistory?.dateTime ?? event.dateTime;
  const hasResetOccurred = !!latestHistory && event.dateTime.getTime() > latestHistory.dateTime.getTime();
  const pastRoll = hasResetOccurred
    ? await occurrencePaymentRoll(event.id, occurrenceDt)
    : await occurrencePaymentRoll(event.id, occurrenceDt, event.currentGameId);

  let hasCost: boolean;
  let allPaid = true;
  let pastGameSource: "game" | "snapshot" | "none" = "none";

  if (pastRoll && pastRoll.length > 0) {
    pastGameSource = "game";
    hasCost = true;
    allPaid = summarizePayments(pastRoll).allPaid;
  } else if (latestHistory?.paymentsSnapshot) {
    // No Game for the occurrence (pre-ADR residue) — frozen snapshot remains
    // the only record.
    pastGameSource = "snapshot";
    hasCost = true;
    try {
      const snapshot = JSON.parse(latestHistory.paymentsSnapshot) as Array<{ status: string }>;
      allPaid = summarizePayments(snapshot).allPaid;
    } catch { /* ignore parse errors */ }
  } else {
    // No Game and no snapshot: a one-off that hasn't reset still surfaces the
    // EventCost template (cost configured, nothing charged yet).
    hasCost = !latestHistory && (eventCost?.totalAmount ?? 0) > 0;
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
  if (!gameEnded && wrapUpSettlement?.mode !== "untracked") {
    const pendingRoll = pastRoll
      ?? (() => {
        if (!latestHistory?.paymentsSnapshot) return null;
        try {
          return JSON.parse(latestHistory.paymentsSnapshot) as Array<{ status: string }>;
        } catch {
          return null;
        }
      })();
    if (pendingRoll && pendingRoll.length > 0) {
      hasPendingPastPayments = !summarizePayments(pendingRoll).allPaid;
    }
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

  if (pastGameSource === "game" && pastRoll) {
    paymentsSnapshot = pastRoll.map((p) => ({
      playerName: p.playerName,
      amount: p.amount,
      status: p.status,
      method: p.method,
    }));
  } else if (pastGameSource === "snapshot" && latestHistory?.paymentsSnapshot) {
    try {
      paymentsSnapshot = JSON.parse(latestHistory.paymentsSnapshot);
    } catch { /* ignore */ }
  }

  // Check if the current user is a participant of the settled game.
  // Owner/Admin always count (settlement role: confirm payments, set score).
  // Otherwise use the shared settled-game participant check.
  let isParticipant = false;
  // Settlement admins (owner/admin) stay responsible for the payment task even
  // after their own share shows paid — the card must stay open until everyone
  // has paid, so their own settlement never hides it.
  let isSettlementAdmin = false;
  if (session?.user) {
    const ownership = await checkOwnership(request, event.ownerId, session, event.id);
    if (ownership?.isOwner || ownership?.isAdmin) {
      isParticipant = true;
      isSettlementAdmin = true;
    } else {
      isParticipant = await isSettledGameParticipant({
        sessionUser: session.user,
        event,
        latestHistory,
      });
    }
  }

  // Whether the current user actually PLAYED the settled game (players-only).
  // Unlike isParticipant, the Owner/Admin settlement override does NOT apply —
  // MVP voting is restricted to players, so an admin who didn't play must not
  // be offered the Vote MVP task nor have the banner held open by MVP state.
  // (Computed before the MVP block; kept here as the canonical definition.)

  // Compute aggregate payment info for social proof
  const snapshotAggregate = summarizePayments(paymentsSnapshot ?? []);
  let paidAggregate = { paidCount: snapshotAggregate.paidCount, totalCount: snapshotAggregate.totalCount };

  if (wrapUpSettlement) {
    hasCost = true;
    const wrapUpAggregate = summarizePayments(wrapUpSettlement.rows);
    allPaid = wrapUpAggregate.allPaid;
    paidAggregate = { paidCount: wrapUpAggregate.paidCount, totalCount: wrapUpAggregate.totalCount };
    // Recompute the wrap-up completion gate — allPaid may have flipped.
    allComplete = hasScore && allPaid && myMvpComplete;
  }

  // The viewer's Season Rank movement for this Game (players only). Null when
  // there is no such game, it did not count, or the viewer didn't play.
  let seasonRank: ViewerGameRank | null = null;
  if (session?.user && isPlayer && latestHistory) {
    seasonRank = await getViewerGameRank(
      event.id,
      {
        dateTime: latestHistory.dateTime,
        status: latestHistory.status,
        isFriendly: latestHistory.isFriendly,
        scoreOne: latestHistory.scoreOne,
        scoreTwo: latestHistory.scoreTwo,
        teamsSnapshot: latestHistory.teamsSnapshot,
      },
      session.user.name,
    );
  }

  // The viewer's current Rank Standing. Unlike the movement above it does not
  // need a score, so the card can show where the player stands — and say that
  // this game is what moves it — while the score task is still pending.
  let rankStanding: ViewerRankStanding | null = null;
  if (session?.user && isPlayer && latestHistory) {
    rankStanding = await getViewerRankStanding(
      event.id,
      {
        dateTime: latestHistory.dateTime,
        isFriendly: latestHistory.isFriendly,
        teamsSnapshot: latestHistory.teamsSnapshot,
      },
      session.user.name,
    );
  }

  // Viewer-scoped payment closure: a debtor who already paid their own share
  // has nothing left to act on. The receiver of the money and the settlement
  // admins keep the task open until every share is in.
  let viewerPaymentSettled = false;
  if (session?.user && !isSettlementAdmin) {
    const viewerName = session.user.name;
    const rows = wrapUpSettlement?.rows ?? [];
    const mine = rows.find((r) => r.name === viewerName);
    const isReceiver = (wrapUpSettlement?.payerName ?? null) === viewerName;
    viewerPaymentSettled = !isReceiver && !!mine && !mine.isPayer && mine.status === "paid";
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
    seasonRank,
    rankStanding,
    viewerPaymentSettled,
    isRecurring: event.isRecurring ?? false,
  };
}
