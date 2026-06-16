import { createHash } from "node:crypto";

/**
 * Idempotency middleware for write endpoints.
 *
 * Opt-in via the `Idempotency-Key` request header. When present, requests with
 * the same key + same payload replay the cached 2xx response. Same key +
 * different payload returns 422. Same key + non-2xx response is not cached,
 * allowing genuine retries to succeed.
 *
 * The cache is in-process; a single Astro server instance is assumed
 * (Litestream + single VM). On horizontal scale, idempotency degrades to
 * "best effort" per instance — see ADR 0012.
 *
 * @see docs/adr/0012-idempotency-middleware.md
 */

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CachedResponse {
  status: number;
  body: string;
  contentType: string;
  payloadHash: string;
  expiresAt: number;
}

const cache = new Map<string, CachedResponse>();

/** Build the cache key from Idempotency-Key, request path, and session userId. */
export function makeCacheKey(rawKey: string, pathname: string, userId: string | null): string {
  return `${pathname}::${userId ?? "anon"}::${rawKey}`;
}

/** Canonicalize an add-player-style body to a stable string for hashing. */
export function canonicalizeBody(body: Record<string, unknown>): string {
  const obj: Record<string, unknown> = {};
  if (typeof body.name === "string") obj.name = body.name.trim();
  if (body.linkToAccount === true) obj.linkToAccount = true;
  if (typeof body.email === "string" && body.email.trim()) {
    obj.email = body.email.trim().toLowerCase();
  }
  const keys = Object.keys(obj).sort();
  return JSON.stringify(obj, keys);
}

/** Hash a canonicalized body. */
export function hashPayload(body: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalizeBody(body)).digest("hex");
}

/** Look up a cached response. Returns null on miss, expiry, or hash mismatch. */
export function getCachedResponse(
  cacheKey: string,
  payloadHash: string,
): CachedResponse | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  if (entry.payloadHash !== payloadHash) return null;
  return entry;
}

/** Indicates a hit but with a payload hash mismatch — the client reused the key with different data. */
export function hasConflictingEntry(cacheKey: string, payloadHash: string): boolean {
  const entry = cache.get(cacheKey);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) return false;
  return entry.payloadHash !== payloadHash;
}

/** Store a 2xx response in the cache. */
export function storeCachedResponse(
  cacheKey: string,
  payloadHash: string,
  status: number,
  body: string,
  contentType: string,
): void {
  if (status < 200 || status >= 300) return;
  cache.set(cacheKey, {
    status,
    body,
    contentType,
    payloadHash,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

/** Drop expired entries. Called periodically by the sweep timer. */
export function sweepExpiredCacheEntries(): number {
  const now = Date.now();
  let dropped = 0;
  for (const [k, v] of cache) {
    if (v.expiresAt < now) {
      cache.delete(k);
      dropped++;
    }
  }
  return dropped;
}

/** Clear the entire cache. Used in tests. */
export function resetIdempotencyCache(): void {
  cache.clear();
}

/** Expose cache size for diagnostics. */
export function idempotencyCacheSize(): number {
  return cache.size;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic sweep. Idempotent — calling twice is a no-op. */
export function startIdempotencySweep(intervalMs = 60_000): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepExpiredCacheEntries();
  }, intervalMs);
  // Don't keep the Node process alive for the sweep alone.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

/** Stop the periodic sweep. Used in tests. */
export function stopIdempotencySweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

// Re-export for testing
export { cache as _cacheForTests };
