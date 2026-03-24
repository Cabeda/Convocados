/**
 * Event-creation rate limiter using in-memory Map with TTL.
 * No database round-trips — suitable for single-instance Fly deployment.
 *
 * Limit: 10 events per hour per IP.
 */
import { createLogger } from "./logger.server";

const log = createLogger("rate-limit");

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 10;
const PRESET = "event-create";

interface RateLimitEntry {
  count: number;
  expiresAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) store.delete(key);
  }
}, 60_000).unref?.();

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `${PRESET}:${ip}`;
  const now = Date.now();

  const entry = store.get(key);

  if (!entry || entry.expiresAt < now) {
    // Window expired or first request — create/reset
    store.set(key, { count: 1, expiresAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  if (entry.count >= MAX_REQUESTS) {
    log.warn({ ip, preset: PRESET, count: entry.count }, "Rate limit exceeded");
    return { allowed: false, remaining: 0 };
  }

  // Increment
  entry.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count };
}

/** Clear all event-creation rate limit entries. Used in tests. */
export async function resetRateLimitStore(): Promise<void> {
  for (const key of store.keys()) {
    if (key.startsWith(`${PRESET}:`)) store.delete(key);
  }
}
