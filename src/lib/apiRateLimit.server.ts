/**
 * General-purpose API rate limiter using in-memory Map with TTL.
 * No database round-trips — suitable for single-instance Fly deployment.
 */
import { createLogger } from "./logger.server";

const log = createLogger("api-rate-limit");

const PRESETS = {
  /** Standard API reads: 120 req/min */
  read: { windowMs: 60_000, maxRequests: 120 },
  /** Mutations (POST/PUT/DELETE): 30 req/min */
  write: { windowMs: 60_000, maxRequests: 30 },
  /** Auth endpoints: 10 req/min */
  auth: { windowMs: 60_000, maxRequests: 10 },
  /** Heavy operations (e.g. ELO recalculate): 1 req/min */
  heavy: { windowMs: 60_000, maxRequests: 1 },
  /** OAuth token endpoint: 20 req/min per IP */
  oauth_token: { windowMs: 60_000, maxRequests: 20 },
  /** OAuth authorize endpoint: 30 req/min per IP */
  oauth_authorize: { windowMs: 60_000, maxRequests: 30 },
  /** OAuth client registration: 5 req/hour per IP */
  oauth_register: { windowMs: 3_600_000, maxRequests: 5 },
} as const;

export type RateLimitPreset = keyof typeof PRESETS;

export function extractIp(request: Request): string {
  return (
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

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

export async function checkApiRateLimit(
  ip: string,
  preset: RateLimitPreset = "read",
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const config = PRESETS[preset];
  const key = `${preset}:${ip}`;
  const now = Date.now();

  const entry = store.get(key);

  if (!entry || entry.expiresAt < now) {
    // Window expired or first request — create/reset
    store.set(key, { count: 1, expiresAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, retryAfterMs: 0 };
  }

  if (entry.count >= config.maxRequests) {
    const retryAfterMs = entry.expiresAt - now;
    log.warn({ ip, preset, count: entry.count, retryAfterMs }, "API rate limit exceeded");
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  // Increment
  entry.count += 1;
  return { allowed: true, remaining: config.maxRequests - entry.count, retryAfterMs: 0 };
}

/**
 * Helper that returns a 429 Response if rate limited, or null if allowed.
 * Use at the top of API route handlers.
 */
export async function rateLimitResponse(
  request: Request,
  preset: RateLimitPreset = "read",
): Promise<Response | null> {
  const ip = extractIp(request);
  const { allowed, retryAfterMs } = await checkApiRateLimit(ip, preset);

  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  return null;
}

/** Clear all API rate limit entries. Used in tests. */
export async function resetApiRateLimitStore(): Promise<void> {
  store.clear();
}

/** Delete all expired rate limit entries. Called from cron. */
export async function cleanupExpiredRateLimits(): Promise<number> {
  const now = Date.now();
  let deleted = 0;
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) {
      store.delete(key);
      deleted++;
    }
  }
  if (deleted > 0) {
    log.info({ deleted }, "Cleaned up expired rate limit entries");
  }
  return deleted;
}
