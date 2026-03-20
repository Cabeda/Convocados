/**
 * Event-creation rate limiter backed by SQLite.
 * Persists across deploys and machine suspends.
 *
 * Limit: 10 events per hour per IP.
 */
import { prisma } from "./db.server";
import { createLogger } from "./logger.server";

const log = createLogger("rate-limit");

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 10;
const PRESET = "event-create";

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `${PRESET}:${ip}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + WINDOW_MS);

  try {
    const entry = await prisma.rateLimit.findUnique({ where: { key } });

    if (!entry || entry.expiresAt < now) {
      // Window expired or first request — create/reset
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, windowStart: now, expiresAt },
        update: { count: 1, windowStart: now, expiresAt },
      });
      return { allowed: true, remaining: MAX_REQUESTS - 1 };
    }

    if (entry.count >= MAX_REQUESTS) {
      log.warn({ ip, preset: PRESET, count: entry.count }, "Rate limit exceeded");
      return { allowed: false, remaining: 0 };
    }

    // Increment
    await prisma.rateLimit.update({
      where: { key },
      data: { count: entry.count + 1 },
    });
    return { allowed: true, remaining: MAX_REQUESTS - (entry.count + 1) };
  } catch (err) {
    // On DB error, fail open to avoid blocking legitimate users
    log.error({ err, ip }, "Rate limit check failed, allowing request");
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }
}

/** Clear all event-creation rate limit entries. Used in tests. */
export async function resetRateLimitStore(): Promise<void> {
  await prisma.rateLimit.deleteMany({
    where: { key: { startsWith: `${PRESET}:` } },
  });
}
