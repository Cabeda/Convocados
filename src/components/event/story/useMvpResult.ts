import { useEffect, useState } from "react";
import { apiRequest } from "~/lib/api/client";

/**
 * Who won MVP, for everyone, once voting has closed. Null while voting is still
 * open, when nobody voted, or while `enabled` is false (a collapsed card asks
 * for nothing). Ties name everybody.
 */
export function useMvpResult(eventId: string, historyId: string | null, enabled: boolean): string[] | null {
  const [winners, setWinners] = useState<string[] | null>(null);

  useEffect(() => {
    if (!enabled || !historyId) return;
    let live = true;
    apiRequest("GET /api/events/{id}/history/{historyId}/mvp", { params: { id: eventId, historyId } })
      .then((data) => {
        const d = data as { isVotingOpen?: boolean; mvp?: Array<{ playerName: string }> | null };
        if (live) setWinners(d.isVotingOpen === false && d.mvp?.length ? d.mvp.map((m) => m.playerName) : null);
      })
      .catch(() => { /* a result line is a courtesy: say nothing rather than something wrong */ });
    return () => { live = false; };
  }, [eventId, historyId, enabled]);

  return winners;
}
