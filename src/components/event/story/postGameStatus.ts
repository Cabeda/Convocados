/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: the poll's async response sets state. */
import { useState, useEffect, useCallback } from "react";
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
}

const POLL_MS = 15_000;

/**
 * The last game's status: seeded from the page payload (so nothing flashes),
 * then kept live by a poll and `refresh()`. The endpoint
 * needs no session — signed-out visitors get the result too.
 */
export function usePostGameStatus(eventId: string, initial: PostGameStatus | null | undefined) {
  const [status, setStatus] = useState<PostGameStatus | null>(initial ?? null);

  const refresh = useCallback(async () => {
    try {
      setStatus((await apiRequest("GET /api/events/{id}/post-game-status", { params: { id: eventId } })) as PostGameStatus);
    } catch { /* keep the last known status */ }
  }, [eventId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { status, refresh };
}
