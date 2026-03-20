import { describe, it, expect, beforeEach } from "vitest";
import { checkApiRateLimit, resetApiRateLimitStore, cleanupExpiredRateLimits } from "../lib/apiRateLimit.server";

describe("checkApiRateLimit (SQLite-backed)", () => {
  beforeEach(async () => {
    await resetApiRateLimitStore();
  });

  it("allows requests within the limit", async () => {
    const ip = "test-ip-" + Date.now();
    const result = await checkApiRateLimit(ip, "write");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29); // 30 max - 1
  });

  it("blocks after exceeding the limit", async () => {
    const ip = "flood-ip-" + Date.now();
    // Exhaust the write limit (30 req/min)
    for (let i = 0; i < 30; i++) {
      await checkApiRateLimit(ip, "write");
    }
    const result = await checkApiRateLimit(ip, "write");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("uses separate stores per preset", async () => {
    const ip = "multi-ip-" + Date.now();
    // Exhaust write limit
    for (let i = 0; i < 30; i++) {
      await checkApiRateLimit(ip, "write");
    }
    // Read should still be allowed (separate key prefix)
    const result = await checkApiRateLimit(ip, "read");
    expect(result.allowed).toBe(true);
  });

  it("read preset allows 120 requests", async () => {
    const ip = "read-ip-" + Date.now();
    for (let i = 0; i < 120; i++) {
      const r = await checkApiRateLimit(ip, "read");
      expect(r.allowed).toBe(true);
    }
    const result = await checkApiRateLimit(ip, "read");
    expect(result.allowed).toBe(false);
  });

  it("cleanup removes expired entries", async () => {
    const { prisma } = await import("~/lib/db.server");
    const ip = "cleanup-test-" + Date.now();
    await checkApiRateLimit(ip, "write");

    // Verify entry exists
    const before = await prisma.rateLimit.count({ where: { key: `write:${ip}` } });
    expect(before).toBe(1);

    // Set entry to expired
    await prisma.rateLimit.updateMany({
      where: { key: `write:${ip}` },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const deleted = await cleanupExpiredRateLimits();
    expect(deleted).toBeGreaterThanOrEqual(1);

    // Verify entry is gone
    const after = await prisma.rateLimit.count({ where: { key: `write:${ip}` } });
    expect(after).toBe(0);
  });

  it("reset clears all API rate limit entries", async () => {
    const { prisma } = await import("~/lib/db.server");
    const ip = "reset-test-" + Date.now();
    await checkApiRateLimit(ip, "write");
    await checkApiRateLimit(ip, "read");

    const before = await prisma.rateLimit.count({
      where: { key: { contains: ip } },
    });
    expect(before).toBe(2);

    await resetApiRateLimitStore();

    const after = await prisma.rateLimit.count({
      where: { key: { contains: ip } },
    });
    expect(after).toBe(0);
  });
});
