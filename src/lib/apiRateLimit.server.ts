/**
 * General-purpose API rate limiter.
 * Separate from the event-creation limiter — this covers all endpoints.
 *
 * Uses a sliding window counter per IP with configurable limits.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(name: string): Map<string, RateLimitEntry> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

// Periodic cleanup to prevent memory leaks (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const store of stores.values()) {
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  }
}, 5 * 60 * 1000);

const PRESETS = {
  /** Standard API reads: 120 req/min */
  read: { windowMs: 60_000, maxRequests: 120 },
  /** Mutations (POST/PUT/DELETE): 30 req/min */
  write: { windowMs: 60_000, maxRequests: 30 },
  /** Auth endpoints: 10 req/min */
  auth: { windowMs: 60_000, maxRequests: 10 },
} as const;

export type RateLimitPreset = keyof typeof PRESETS;

export function extractIp(request: Request): string {
  return (
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

export function checkApiRateLimit(
  ip: string,
  preset: RateLimitPreset = "read",
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const config = PRESETS[preset];
  const store = getStore(preset);
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || entry.resetAt < now) {
    store.set(ip, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, retryAfterMs: 0 };
  }

  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  return { allowed: true, remaining: config.maxRequests - entry.count, retryAfterMs: 0 };
}

/**
 * Helper that returns a 429 Response if rate limited, or null if allowed.
 * Use at the top of API route handlers.
 */
export function rateLimitResponse(
  request: Request,
  preset: RateLimitPreset = "read",
): Response | null {
  const ip = extractIp(request);
  const { allowed, remaining, retryAfterMs } = checkApiRateLimit(ip, preset);

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

export function resetApiRateLimitStore(): void {
  for (const store of stores.values()) {
    store.clear();
  }
}
