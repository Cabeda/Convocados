import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock better-auth, Google token verification, rate limiter, and the image
// sync lib so this test only exercises the route wiring in [...all].ts.
const mockAuthHandler = vi.fn();
const mockGetSession = vi.fn();
const mockVerifyGoogle = vi.fn();
const mockRateLimit = vi.fn();
const mockSyncImage = vi.fn();

vi.mock("~/lib/auth.server", () => ({
  auth: {
    handler: (...args: any[]) => mockAuthHandler(...args),
    api: { getSession: (...args: any[]) => mockGetSession(...args) },
  },
  ensureTrustedClientInDB: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/googleToken.server", () => ({
  verifyGoogleIdToken: (...args: any[]) => mockVerifyGoogle(...args),
}));
vi.mock("~/lib/oauthRateLimit.server", () => ({
  oauthRateLimitResponse: (...args: any[]) => mockRateLimit(...args),
}));
vi.mock("~/lib/syncGoogleImage.server", () => ({
  syncGoogleProfileImage: (...args: any[]) => mockSyncImage(...args),
}));

import { GET, POST } from "~/pages/api/auth/[...all]";

const SESSION_COOKIE = "better-auth.session_token=abc123; Path=/; HttpOnly";

function responseWithSession(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "set-cookie": SESSION_COOKIE },
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue(null);
  mockGetSession.mockResolvedValue({ user: { id: "user-sync-test" } });
});

describe("POST /api/auth/sign-in/social — Google id-token sign-in", () => {
  it("extracts the picture from the google id token and backfills the user image", async () => {
    mockAuthHandler.mockResolvedValueOnce(responseWithSession(200, { redirect: false, token: "t" }));
    mockVerifyGoogle.mockResolvedValueOnce({ sub: "g1", email: "a@b.com", picture: "https://example.com/token-pic.jpg" });

    const req = new Request("http://localhost/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", idToken: { token: "jwt-here" } }),
    });

    const res = await POST({ request: req, params: {} } as any);

    expect(res.status).toBe(200);
    expect(mockVerifyGoogle).toHaveBeenCalledWith("jwt-here", expect.any(Array));
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockSyncImage).toHaveBeenCalledWith("user-sync-test", "https://example.com/token-pic.jpg");
  });

  it("does not verify or sync for a non-google provider", async () => {
    mockAuthHandler.mockResolvedValueOnce(responseWithSession(200, { redirect: false, token: "t" }));

    const req = new Request("http://localhost/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", idToken: { token: "jwt-here" } }),
    });

    await POST({ request: req, params: {} } as any);

    expect(mockVerifyGoogle).not.toHaveBeenCalled();
    expect(mockSyncImage).not.toHaveBeenCalled();
  });

  it("skips sync when the login itself fails", async () => {
    mockAuthHandler.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }));

    const req = new Request("http://localhost/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", idToken: { token: "jwt-here" } }),
    });

    const res = await POST({ request: req, params: {} } as any);

    expect(res.status).toBe(401);
    expect(mockSyncImage).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/callback/google — web OAuth redirect", () => {
  it("backfills the image from stored google tokens after a successful callback", async () => {
    mockAuthHandler.mockImplementationOnce(() => {
      throw new Response(null, {
        status: 302,
        headers: { location: "http://localhost/", "set-cookie": SESSION_COOKIE },
      });
    });

    const req = new Request("http://localhost/api/auth/callback/google?code=x&state=y", { method: "GET" });

    const res = await GET({ request: req, params: {} } as any);

    expect(res.status).toBe(302);
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockSyncImage).toHaveBeenCalledWith("user-sync-test", null);
  });

  it("does not sync for unrelated auth routes", async () => {
    mockAuthHandler.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const req = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "pw" }),
    });

    await POST({ request: req, params: {} } as any);

    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockSyncImage).not.toHaveBeenCalled();
  });

  it("still returns the handler response when the image sync fails", async () => {
    mockAuthHandler.mockImplementationOnce(() => {
      throw new Response(null, { status: 302, headers: { location: "http://localhost/", "set-cookie": SESSION_COOKIE } });
    });
    mockGetSession.mockRejectedValueOnce(new Error("boom"));

    const req = new Request("http://localhost/api/auth/callback/google?code=x", { method: "GET" });

    const res = await GET({ request: req, params: {} } as any);

    expect(res.status).toBe(302);
  });
});