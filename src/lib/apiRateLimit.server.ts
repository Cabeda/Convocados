/**
 * General-purpose API rate limiter backed by SQLite.
 * Persists across deploys and machine suspends.
 *
 * Uses Prisma upsert for atomic increment-or-create.
 */
import { prisma } from "./db.server";
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
} as const;

export type RateLimitPreset = keyof typeof PRESETS;

export function extractIp(request: Request): string {
  return (
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

export async function checkApiRateLimit(
  ip: string,
  preset: RateLimitPreset = "read",
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const config = PRESETS[preset];
  const key = `${preset}:${ip}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.windowMs);

  try {
    const entry = await prisma.rateLimit.findUnique({ where: { key } });

    if (!entry || entry.expiresAt < now) {
      // Window expired or first request — create/reset
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, windowStart: now, expiresAt },
        update: { count: 1, windowStart: now, expiresAt },
      });
      return { allowed: true, remaining: config.maxRequests - 1, retryAfterMs: 0 };
    }

    if (entry.count >= config.maxRequests) {
      const retryAfterMs = entry.expiresAt.getTime() - now.getTime();
      log.warn({ ip, preset, count: entry.count, retryAfterMs }, "API rate limit exceeded");
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    // Increment
    await prisma.rateLimit.update({
      where: { key },
      data: { count: entry.count + 1 },
    });
    return { allowed: true, remaining: config.maxRequests - (entry.count + 1), retryAfterMs: 0 };
  } catch (err) {
    // On DB error, fail open to avoid blocking legitimate users
    log.error({ err, ip, preset }, "API rate limit check failed, allowing request");
    return { allowed: true, remaining: config.maxRequests - 1, retryAfterMs: 0 };
  }
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
  const { allowed, remaining, retryAfterMs } = await checkApiRateLimit(ip, preset);

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
  await prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: "read:" } },
        { key: { startsWith: "write:" } },
        { key: { startsWith: "auth:" } },
        { key: { startsWith: "heavy:" } },
      ],
    },
  });
}

/** Delete all expired rate limit entries. Called from cron. */
export async function cleanupExpiredRateLimits(): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    log.info({ deleted: result.count }, "Cleaned up expired rate limit entries");
  }
  return result.count;
}
