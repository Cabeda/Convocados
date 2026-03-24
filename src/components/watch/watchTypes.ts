/** Shared types for the watch PWA */
export interface WatchEvent {
  id: string;
  title: string;
  sport: string;
  dateTime: string;
  teamOneName: string;
  teamTwoName: string;
  hasTeams: boolean;
  isHappeningNow: boolean;
  hasHistory: boolean;
  latestGame: {
    id: string;
    scoreOne: number;
    scoreTwo: number;
    teamOneName: string;
    teamTwoName: string;
    editable: boolean;
  } | null;
}

/** Response from GET /api/watch/events (list mode) */
export interface WatchEventsResponse {
  events: WatchEvent[];
  /** Event ID to auto-navigate to (only set for logged-in users) */
  autoSelectId: string | null;
}

/** IndexedDB helpers for offline score sync */
export interface PendingSync {
  eventId: string;
  historyId: string;
  scoreOne: number;
  scoreTwo: number;
  timestamp: number;
}

const DB_NAME = "convocados-watch";
const STORE_NAME = "pending-syncs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "historyId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePendingSync(sync: PendingSync): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(sync);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingSyncs(): Promise<PendingSync[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingSync(historyId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(historyId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Flush all pending syncs to the server. Returns count of successful syncs. */
export async function flushPendingSyncs(): Promise<number> {
  const pending = await getPendingSyncs();
  let synced = 0;
  for (const p of pending) {
    try {
      const res = await fetch(`/api/events/${p.eventId}/history/${p.historyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoreOne: p.scoreOne, scoreTwo: p.scoreTwo }),
      });
      if (res.ok) {
        await removePendingSync(p.historyId);
        synced++;
      }
    } catch {
      // Still offline, skip
    }
  }
  return synced;
}
