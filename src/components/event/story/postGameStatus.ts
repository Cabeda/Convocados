import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest } from "~/lib/api/client";
import type { SeasonRankMovement } from "~/lib/rankExplainer";

/** The last game's wrap-up state for the current viewer (GET /api/events/{id}/post-game-status). */
export interface PostGameStatus {
  gameEnded: boolean;
  hasScore: boolean;
  hasCost: boolean;
  allPaid: boolean;
  allComplete: boolean;
  isParticipant: boolean;
  isPlayer: boolean;
  latestHistoryId: string | null;
  /** An ended one-off with no history row yet: the live game its first score is saved on. */
  pendingGameId?: string | null;
  costCurrency: string | null;
  costAmount: number | null;
  hasPendingPastPayments: boolean;
  mvpEnabled: boolean;
  mvpComplete: boolean;
  bannerMvpComplete: boolean;
  /** Viewer-scoped MVP task: true once THIS user has voted (or has no task). */
  myMvpComplete?: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teamOneName: string;
  teamTwoName: string;
  gamePayments: Array<{ eventPlayerId: string; name: string; amount: number; status: string; isPayer: boolean }> | null;
  gameConfig: { gameId: string; mode: "tracked" | "untracked"; payerName: string | null; payerIsPlayer: boolean } | null;
  /** The viewer's Season Rank movement from this game, when it counted. */
  seasonRank?: SeasonRankMovement | null;
  isRecurring?: boolean;
  /** The viewer already paid their own share and is neither the receiver nor a settlement admin. */
  viewerPaymentSettled?: boolean;
  /** Kickoff of the last game; null when there is none or it was cancelled. */
  lastGameDateTime?: string | null;
  /** Which team the viewer played for in the last game (0 = score one). */
  viewerTeam?: 0 | 1 | null;
  /** The account name plus the roster names linked to the viewer's account. */
  viewerNames?: string[];
  /** How many people played the last game; null when unknown. */
  lastGamePlayerCount?: number | null;
  /** The collector has payment details to show ("How to pay"). */
  payerHasPaymentDetails?: boolean;
}

/** What the viewer has just done, believed before the server confirms it. */
export interface Optimistic {
  /** The score they saved. */
  score?: [number, number];
  /** They voted for MVP. */
  voted?: true;
  /** Payment rows they reported as sent. */
  paidIds?: string[];
}

/**
 * The status as the viewer has just changed it. Layered on top of whatever the
 * server last said, so a stale poll can never bring a settled row back; once the
 * server catches up (it has the score, the row is no longer pending) it wins.
 */
export function applyOptimistic(status: PostGameStatus, o: Optimistic): PostGameStatus {
  let out = status;
  if (o.score && !(status.scoreOne !== null && status.scoreTwo !== null)) {
    out = { ...out, hasScore: true, scoreOne: o.score[0], scoreTwo: o.score[1] };
  }
  if (o.voted && out.myMvpComplete === false) out = { ...out, myMvpComplete: true };
  const paid = o.paidIds;
  if (paid?.length && out.gamePayments) {
    out = {
      ...out,
      gamePayments: out.gamePayments.map((r) => (paid.includes(r.eventPlayerId) && r.status === "pending" ? { ...r, status: "sent" } : r)),
    };
  }
  return out;
}

const POLL_MS = 15_000;

/**
 * The last game's status: seeded from the page payload (so nothing flashes and
 * nothing is fetched twice), then kept live by a poll and `refresh()`. The poll
 * sleeps while the tab is hidden and while the caller says the recap is gone
 * (`setPaused`). The endpoint needs no session — signed-out visitors get the
 * result too.
 */
export function usePostGameStatus(eventId: string, initial: PostGameStatus | null | undefined) {
  const [status, setStatus] = useState<PostGameStatus | null>(initial ?? null);
  // True once there is a status to show: seeded, or the first read has come back.
  const [loaded, setLoaded] = useState(!!initial);
  const pausedRef = useRef(false);
  const seeded = useRef(!!initial);

  const refresh = useCallback(async () => {
    try {
      setStatus((await apiRequest("GET /api/events/{id}/post-game-status", { params: { id: eventId } })) as PostGameStatus);
    } catch { /* keep the last known status */ }
    setLoaded(true);
  }, [eventId]);

  const setPaused = useCallback((paused: boolean) => { pausedRef.current = paused; }, []);

  useEffect(() => {
    if (!seeded.current) refresh();
    const awake = () => !pausedRef.current && !document.hidden;
    const id = setInterval(() => { if (awake()) refresh(); }, POLL_MS);
    const onVisible = () => { if (awake()) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { status, loaded, refresh, setPaused };
}
