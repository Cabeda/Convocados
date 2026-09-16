import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// The limiter runs before authentication, so a burst of unauthenticated calls
// exercises the throttle without needing a session.
vi.mock("~/lib/db.server", () => ({ prisma: {} }));

const { POST: createApiKey } = await import("~/pages/api/me/api-keys");

const IP = "203.0.113.7";

function req() {
  return new Request("http://localhost/api/me/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": IP },
    body: JSON.stringify({ name: "leak-attempt" }),
  });
}

describe("sensitive mutation routes are rate limited", () => {
  beforeEach(async () => {
    await resetApiRateLimitStore();
  });

  it("throttles a burst of API-key creations with 429", async () => {
    // The write preset allows 30/min; the first 30 are rejected by auth (401)
    // but must NOT be throttled.
    for (let i = 0; i < 30; i++) {
      const res = await createApiKey({ request: req() } as never);
      expect(res.status).toBe(401);
    }

    const throttled = await createApiKey({ request: req() } as never);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBeTruthy();
  });
});
