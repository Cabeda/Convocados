import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "~/pages/api/auth/google-client-id";

describe("GET /api/auth/google-client-id", () => {
  const originalEnv = process.env.GOOGLE_CLIENT_ID;

  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GOOGLE_CLIENT_ID = originalEnv;
    } else {
      delete process.env.GOOGLE_CLIENT_ID;
    }
  });

  it("returns GOOGLE_CLIENT_ID from process.env", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-google-client.apps.googleusercontent.com";

    const response = await GET({} as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      clientId: "test-google-client.apps.googleusercontent.com",
    });
  });

  it("returns an empty client ID when Google sign-in is not configured", async () => {
    const response = await GET({} as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ clientId: "" });
  });
});
