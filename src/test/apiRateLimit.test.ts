import { describe, it, expect } from "vitest";
import { checkApiRateLimit } from "../lib/apiRateLimit.server";

describe("checkApiRateLimit", () => {
  it("allows requests within the limit", () => {
    const ip = "test-ip-" + Date.now();
    const result = checkApiRateLimit(ip, "write");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29); // 30 max - 1
  });

  it("blocks after exceeding the limit", () => {
    const ip = "flood-ip-" + Date.now();
    // Exhaust the write limit (30 req/min)
    for (let i = 0; i < 30; i++) {
      checkApiRateLimit(ip, "write");
    }
    const result = checkApiRateLimit(ip, "write");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("uses separate stores per preset", () => {
    const ip = "multi-ip-" + Date.now();
    // Exhaust write limit
    for (let i = 0; i < 30; i++) {
      checkApiRateLimit(ip, "write");
    }
    // Read should still be allowed (separate store)
    const result = checkApiRateLimit(ip, "read");
    expect(result.allowed).toBe(true);
  });

  it("read preset allows 120 requests", () => {
    const ip = "read-ip-" + Date.now();
    for (let i = 0; i < 120; i++) {
      const r = checkApiRateLimit(ip, "read");
      expect(r.allowed).toBe(true);
    }
    const result = checkApiRateLimit(ip, "read");
    expect(result.allowed).toBe(false);
  });
});
