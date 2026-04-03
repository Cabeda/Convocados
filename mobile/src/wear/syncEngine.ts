/**
 * Sync engine for WearOS offline-first score tracking.
 *
 * Flushes pending score updates to the server when online.
 * Uses NetInfo to detect connectivity changes.
 */
import NetInfo from "@react-native-community/netinfo";
import { getPendingSyncs, removePendingSync } from "./offlineStorage";
import { updateScore } from "~/api/endpoints";

/** Flush all pending syncs. Returns count of successful syncs. */
export async function flushPendingSyncs(): Promise<number> {
  const pending = await getPendingSyncs();
  let synced = 0;

  for (const p of pending) {
    try {
      await updateScore(p.eventId, p.historyId, p.scoreOne, p.scoreTwo);
      await removePendingSync(p.historyId);
      synced++;
    } catch {
      // Still offline or server error — skip, will retry later
    }
  }

  return synced;
}

/** Start listening for connectivity changes and auto-flush */
export function startSyncListener(onSync?: (count: number) => void): () => void {
  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      flushPendingSyncs().then((count) => {
        if (count > 0 && onSync) onSync(count);
      });
    }
  });

  // Also flush immediately on start
  flushPendingSyncs().then((count) => {
    if (count > 0 && onSync) onSync(count);
  });

  return unsubscribe;
}
