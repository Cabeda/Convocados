/**
 * Short-TTL cache for Playtomic availability, shared across all court watches
 * and the live search. Collapses identical (tenant, sport, date) queries into a
 * single upstream fetch to stay well within Playtomic's tolerance and avoid
 * IP blocks at scale.
 */

import { prisma } from "./db.server";
import { getAvailability, type PlaytomicCourtAvailability } from "./playtomic.server";
import { playtomicSportIds } from "./playtomic";

export const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_CONCURRENCY = 5;
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // purge entries older than 1 day

export interface AvailabilityKey {
  tenantId: string;
  sport: string;
  date: string; // YYYY-MM-DD
}

export function availabilityKeyStr(k: AvailabilityKey): string {
  return `${k.tenantId}|${k.sport}|${k.date}`;
}

/**
 * Fetch availability for all Playtomic sport variants of a Convocados sport and
 * merge the court results (deduped by resource_id). This handles clubs that
 * register courts under different sport IDs (e.g. FUTSAL vs FOOTBALL_OTHERS).
 */
async function fetchAllSportVariants(key: AvailabilityKey): Promise<{ courts: PlaytomicCourtAvailability[]; error?: string }> {
  const ids = playtomicSportIds(key.sport);
  if (!ids) return { courts: [], error: "Unsupported sport" };

  const allCourts: PlaytomicCourtAvailability[] = [];
  const seenResourceIds = new Set<string>();
  let lastError: string | undefined;

  for (const sportId of ids) {
    const { courts, error } = await getAvailability({ tenantId: key.tenantId, sport: key.sport, date: key.date, _sportIdOverride: sportId });
    if (error) { lastError = error; continue; }
    for (const court of courts) {
      if (seenResourceIds.has(court.resource_id)) continue;
      seenResourceIds.add(court.resource_id);
      allCourts.push(court);
    }
  }

  if (allCourts.length === 0 && lastError) return { courts: [], error: lastError };
  return { courts: allCourts };
}

/**
 * Get availability for one (tenant, sport, date), using the DB cache when fresh.
 * Always fetches ALL durations so different-duration watches can share the entry.
 */
export async function getCachedAvailability(
  key: AvailabilityKey,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<{ courts: PlaytomicCourtAvailability[]; error?: string; cached: boolean }> {
  const cacheKey = availabilityKeyStr(key);

  const cached = await prisma.playtomicAvailabilityCache.findUnique({ where: { cacheKey } });
  if (cached && Date.now() - cached.fetchedAt.getTime() < ttlMs) {
    try {
      return { courts: JSON.parse(cached.courtsJson) as PlaytomicCourtAvailability[], cached: true };
    } catch {
      // fall through to refetch on corrupt cache
    }
  }

  const { courts, error } = await fetchAllSportVariants(key);
  if (error) {
    // On error, serve stale cache if we have any rather than failing the watch
    if (cached) {
      try {
        return { courts: JSON.parse(cached.courtsJson) as PlaytomicCourtAvailability[], cached: true };
      } catch {
        /* ignore */
      }
    }
    return { courts: [], error, cached: false };
  }

  await prisma.playtomicAvailabilityCache.upsert({
    where: { cacheKey },
    create: { cacheKey, courtsJson: JSON.stringify(courts) },
    update: { courtsJson: JSON.stringify(courts), fetchedAt: new Date() },
  });

  return { courts, cached: false };
}

/** Run an async mapper over items with a bounded number of concurrent workers. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetch availability for a set of unique keys, deduped and with bounded
 * concurrency. Returns a Map keyed by availabilityKeyStr.
 */
export async function fetchAvailabilityGrouped(
  keys: AvailabilityKey[],
  options: { ttlMs?: number; concurrency?: number } = {},
): Promise<Map<string, PlaytomicCourtAvailability[]>> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // Dedup keys
  const uniqueMap = new Map<string, AvailabilityKey>();
  for (const k of keys) uniqueMap.set(availabilityKeyStr(k), k);
  const uniqueKeys = [...uniqueMap.values()];

  const result = new Map<string, PlaytomicCourtAvailability[]>();
  await mapWithConcurrency(uniqueKeys, concurrency, async (k) => {
    const { courts } = await getCachedAvailability(k, ttlMs);
    result.set(availabilityKeyStr(k), courts);
  });

  return result;
}

/** Delete cache rows older than maxAgeMs. Returns the number of rows removed. */
export async function purgeStaleAvailabilityCache(maxAgeMs: number = DEFAULT_MAX_AGE_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const { count } = await prisma.playtomicAvailabilityCache.deleteMany({
    where: { fetchedAt: { lt: cutoff } },
  });
  return count;
}
