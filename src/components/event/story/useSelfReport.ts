import { useCallback, useState } from "react";
import { apiRequest } from "~/lib/api/client";
import type { PostGameStatus } from "./postGameStatus";

/** "I paid": the viewer reports their own share of the last game (the payer confirms it). */
export function useSelfReport(eventId: string, status: PostGameStatus) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const report = useCallback(async (eventPlayerId: string): Promise<boolean> => {
    if (!status.gameConfig) return false;
    setBusy(true);
    setFailed(false);
    try {
      await apiRequest("POST /api/events/{id}/payments/settlement/self-report", {
        params: { id: eventId }, body: { gameId: status.gameConfig.gameId, eventPlayerId },
      });
      setBusy(false);
      return true;
    } catch {
      setFailed(true);
      setBusy(false);
      return false;
    }
  }, [eventId, status.gameConfig]);

  return { report, busy, failed };
}
