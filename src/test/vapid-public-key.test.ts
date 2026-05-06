import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "~/pages/api/push/vapid-public-key";

describe("GET /api/push/vapid-public-key", () => {
  const originalEnv = process.env.VAPID_PUBLIC_KEY;

  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.VAPID_PUBLIC_KEY = originalEnv;
    } else {
      delete process.env.VAPID_PUBLIC_KEY;
    }
  });

  it("returns VAPID_PUBLIC_KEY from process.env", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-key-123";
    const res = await GET({} as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicKey).toBe("test-key-123");
  });

  it("returns empty string when no key is set", async () => {
    const res = await GET({} as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicKey).toBe("");
  });
});
