import { createHash } from "node:crypto";
import { createTtlStore } from "./ttlStore";

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

const IDEMPOTENCY_MAX_ENTRIES = 1000;
const store = createTtlStore<CachedResponse>(IDEMPOTENCY_MAX_ENTRIES);
const cache = store.raw;

export function makeCacheKey(rawKey: string, pathname: string, userId: string | null): string {
  return `${pathname}::${userId ?? "anon"}::${rawKey}`;
}

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

export function hashPayload(body: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalizeBody(body)).digest("hex");
}

export function getCachedResponse(
  cacheKey: string,
  payloadHash: string,
): CachedResponse | null {
  const entry = store.get(cacheKey);
  if (!entry) return null;
  if (entry.payloadHash !== payloadHash) return null;
  return entry;
}

export function hasConflictingEntry(cacheKey: string, payloadHash: string): boolean {
  const entry = store.get(cacheKey);
  if (!entry) return false;
  return entry.payloadHash !== payloadHash;
}

export function storeCachedResponse(
  cacheKey: string,
  payloadHash: string,
  status: number,
  body: string,
  contentType: string,
): void {
  if (status < 200 || status >= 300) return;
  store.set(cacheKey, {
    status,
    body,
    contentType,
    payloadHash,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

export function sweepExpiredCacheEntries(): number {
  return store.sweep();
}

export function resetIdempotencyCache(): void {
  store.clear();
}

export function idempotencyCacheSize(): number {
  return store.size();
}

export { cache as _cacheForTests };

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startIdempotencySweep(intervalMs = 60_000): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepExpiredCacheEntries();
  }, intervalMs);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

export function stopIdempotencySweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
