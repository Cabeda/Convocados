/**
 * Offline-first storage for WearOS score tracking.
 *
 * Uses AsyncStorage (works on WearOS via React Native) to persist
 * pending score updates that sync when connectivity is restored.
 * Mirrors the web watch PWA's IndexedDB approach.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PendingScoreSync } from "~/types/api";

const PENDING_KEY = "convocados_pending_syncs";

export async function getPendingSyncs(): Promise<PendingScoreSync[]> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function savePendingSync(sync: PendingScoreSync): Promise<void> {
  const existing = await getPendingSyncs();
  // Upsert by historyId
  const idx = existing.findIndex((s) => s.historyId === sync.historyId);
  if (idx >= 0) {
    existing[idx] = sync;
  } else {
    existing.push(sync);
  }
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(existing));
}

export async function removePendingSync(historyId: string): Promise<void> {
  const existing = await getPendingSyncs();
  const filtered = existing.filter((s) => s.historyId !== historyId);
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(filtered));
}

export async function clearAllPendingSyncs(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}
