import { describe, it, expect, beforeEach } from "vitest";
import { checkApiRateLimit, resetApiRateLimitStore, cleanupExpiredRateLimits } from "../lib/apiRateLimit.server";

describe("checkApiRateLimit (in-memory)", () => {
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
    const ip = "cleanup-test-" + Date.now();
    await checkApiRateLimit(ip, "write");

    // No expired entries yet
    const deleted = await cleanupExpiredRateLimits();
    expect(deleted).toBe(0);
  });

  it("reset clears all API rate limit entries", async () => {
    const ip = "reset-test-" + Date.now();
    await checkApiRateLimit(ip, "write");
    await checkApiRateLimit(ip, "read");

    await resetApiRateLimitStore();

    // After reset, should be allowed again with full remaining
    const r = await checkApiRateLimit(ip, "write");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(29);
  });
});
