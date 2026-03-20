import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimitStore } from "~/lib/rateLimit.server";

describe("checkRateLimit (SQLite-backed)", () => {
  beforeEach(async () => {
    await resetRateLimitStore();
  });

  it("allows first request", async () => {
    const result = await checkRateLimit("1.2.3.4");
    expect(result.allowed).toBe(true);
  });

  it("tracks remaining count", async () => {
    const ip = "10.0.0.1";
    const r1 = await checkRateLimit(ip);
    expect(r1.remaining).toBe(9);
    const r2 = await checkRateLimit(ip);
    expect(r2.remaining).toBe(8);
  });

  it("blocks after MAX_REQUESTS", async () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < 10; i++) await checkRateLimit(ip);
    const result = await checkRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets after window expires (via direct DB manipulation)", async () => {
    const { prisma } = await import("~/lib/db.server");
    const ip = "10.0.0.3";
    for (let i = 0; i < 10; i++) await checkRateLimit(ip);
    expect((await checkRateLimit(ip)).allowed).toBe(false);

    // Simulate window expiry by setting expiresAt to the past
    await prisma.rateLimit.updateMany({
      where: { key: { startsWith: "event-create:" + ip } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await checkRateLimit(ip);
    expect(result.allowed).toBe(true);
  });

  it("different IPs have independent limits", async () => {
    const ipA = "192.168.1.1";
    const ipB = "192.168.1.2";
    for (let i = 0; i < 10; i++) await checkRateLimit(ipA);
    expect((await checkRateLimit(ipA)).allowed).toBe(false);
    expect((await checkRateLimit(ipB)).allowed).toBe(true);
  });

  it("persists across resetRateLimitStore and re-creation", async () => {
    const ip = "persist-test";
    for (let i = 0; i < 5; i++) await checkRateLimit(ip);
    const r = await checkRateLimit(ip);
    expect(r.remaining).toBe(4); // 10 - 6

    // Reset clears the store
    await resetRateLimitStore();
    const r2 = await checkRateLimit(ip);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(9);
  });
});
