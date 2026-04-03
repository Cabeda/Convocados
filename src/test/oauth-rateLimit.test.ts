import { describe, it, expect, beforeEach } from "vitest";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { oauthRateLimitResponse } from "~/lib/oauthRateLimit.server";

beforeEach(async () => {
  await resetApiRateLimitStore();
});

function makeRequest(path: string, ip = "1.2.3.4"): Request {
  return new Request(`http://localhost:4321${path}`, {
    headers: { "x-forwarded-for": ip },
  });
}

describe("OAuth rate limiting", () => {
  it("allows requests under the token endpoint limit (20/min)", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/token"));
      expect(res).toBeNull();
    }
    // 21st should be blocked
    const res = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/token"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("allows requests under the authorize endpoint limit (30/min)", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/authorize"));
      expect(res).toBeNull();
    }
    const res = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/authorize"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("allows requests under the register endpoint limit (5/hour)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/register"));
      expect(res).toBeNull();
    }
    const res = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/register"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("rate limits are per-IP", async () => {
    // Exhaust limit for IP A
    for (let i = 0; i < 20; i++) {
      await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/token", "10.0.0.1"));
    }
    const blockedA = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/token", "10.0.0.1"));
    expect(blockedA).not.toBeNull();

    // IP B should still be allowed
    const allowedB = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/token", "10.0.0.2"));
    expect(allowedB).toBeNull();
  });

  it("returns null for non-OAuth paths", async () => {
    const res = await oauthRateLimitResponse(makeRequest("/api/events"));
    expect(res).toBeNull();
  });

  it("429 response includes Retry-After header", async () => {
    for (let i = 0; i < 20; i++) {
      await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/token"));
    }
    const res = await oauthRateLimitResponse(makeRequest("/api/auth/oauth2/token"));
    expect(res).not.toBeNull();
    expect(res!.headers.get("Retry-After")).toBeDefined();
    const retryAfter = parseInt(res!.headers.get("Retry-After")!, 10);
    expect(retryAfter).toBeGreaterThan(0);
  });
});
