import { useCallback } from "react";
import { apiRequest } from "~/lib/api/client";
import type { Optimistic, PostGameStatus } from "./postGameStatus";
import { useOptimisticAction } from "./useOptimisticAction";

export interface SelfReportHooks {
  onOptimistic?: (patch: Optimistic) => void;
  onRollback?: (key: keyof Optimistic) => void;
}

export interface SelfReportCallbacks {
  /** The row is hidden (before the server answers). */
  applied?: () => void;
  /** The server refused: the row is back. */
  reverted?: () => void;
}

/**
 * "I've paid": the viewer tells the collector they sent their share (the
 * collector confirms it). The row hides at once; if the server refuses it comes
 * back with an error. Tapping again while the first is in flight does nothing.
 */
export function useSelfReport(eventId: string, status: PostGameStatus | null, hooks: SelfReportHooks = {}) {
  const { run, failed, clearFailed } = useOptimisticAction();
  const { onOptimistic, onRollback } = hooks;

  const report = useCallback((eventPlayerId: string, cb: SelfReportCallbacks = {}): Promise<boolean> => {
    if (!status?.gameConfig) return Promise.resolve(false);
    const gameId = status.gameConfig.gameId;
    return run({
      apply: () => { onOptimistic?.({ paidIds: [eventPlayerId] }); cb.applied?.(); },
      request: () => apiRequest("POST /api/events/{id}/payments/settlement/self-report", {
        params: { id: eventId }, body: { gameId, eventPlayerId },
      }),
      revert: () => { onRollback?.("paidIds"); cb.reverted?.(); },
    });
  }, [run, eventId, status, onOptimistic, onRollback]);

  return { report, failed, clearFailed };
}
