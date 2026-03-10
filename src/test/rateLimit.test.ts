import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit } from "~/lib/rateLimit.server";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first request", () => {
    const result = checkRateLimit("1.2.3.4");
    expect(result.allowed).toBe(true);
  });

  it("tracks remaining count", () => {
    const ip = "10.0.0.1";
    const r1 = checkRateLimit(ip);
    expect(r1.remaining).toBe(9);
    const r2 = checkRateLimit(ip);
    expect(r2.remaining).toBe(8);
  });

  it("blocks after MAX_REQUESTS", () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < 10; i++) checkRateLimit(ip);
    const result = checkRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets after window expires", () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < 10; i++) checkRateLimit(ip);
    expect(checkRateLimit(ip).allowed).toBe(false);

    // Advance time past the 1-hour window
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    const result = checkRateLimit(ip);
    expect(result.allowed).toBe(true);
  });

  it("different IPs have independent limits", () => {
    const ipA = "192.168.1.1";
    const ipB = "192.168.1.2";
    for (let i = 0; i < 10; i++) checkRateLimit(ipA);
    expect(checkRateLimit(ipA).allowed).toBe(false);
    expect(checkRateLimit(ipB).allowed).toBe(true);
  });
});
