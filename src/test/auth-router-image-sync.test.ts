import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock better-auth, Google token verification, rate limiter, and the image
// sync lib so this test only exercises the route wiring in [...all].ts.
const mockAuthHandler = vi.fn<(request: Request) => Promise<Response>>();
const mockVerifyGoogle = vi.fn<(token: string, audiences: string[]) => Promise<{ picture?: string } | null>>();
const mockRateLimit = vi.fn<(request: Request) => Promise<Response | null>>();
const mockBackfillImage = vi.fn<(response: Response, picture: string | null) => Promise<void>>();

vi.mock("~/lib/auth.server", () => ({
  auth: {
    handler: (request: Request) => mockAuthHandler(request),
    api: { getSession: vi.fn() },
  },
  ensureTrustedClientInDB: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/googleToken.server", () => ({
  verifyGoogleIdToken: (token: string, audiences: string[]) => mockVerifyGoogle(token, audiences),
}));
vi.mock("~/lib/oauthRateLimit.server", () => ({
  oauthRateLimitResponse: (request: Request) => mockRateLimit(request),
}));
vi.mock("~/lib/syncGoogleImage.server", () => ({
  backfillGoogleProfileImageFromLogin: (response: Response, picture: string | null) =>
    mockBackfillImage(response, picture),
}));

import { GET, POST } from "~/pages/api/auth/[...all]";

const SESSION_COOKIE = "better-auth.session_token=abc123; Path=/; HttpOnly";

function responseWithSession(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "set-cookie": SESSION_COOKIE },
  });
}

function route(request: Request) {
  return { request, params: {} } as Parameters<typeof POST>[0];
}

function googleLoginRequest(provider: string) {
  return new Request("http://localhost/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, idToken: { token: "jwt-here" } }),
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue(null);
});

describe("POST /api/auth/sign-in/social — Google id-token sign-in", () => {
  it("extracts the picture from the google id token and backfills the user image", async () => {
    mockAuthHandler.mockResolvedValueOnce(responseWithSession(200, { redirect: false, token: "t" }));
    mockVerifyGoogle.mockResolvedValueOnce({ picture: "https://example.com/token-pic.jpg" });

    const res = await POST(route(googleLoginRequest("google")));

    expect(res.status).toBe(200);
    expect(mockVerifyGoogle).toHaveBeenCalledWith("jwt-here", expect.any(Array));
    expect(mockBackfillImage).toHaveBeenCalledWith(res, "https://example.com/token-pic.jpg");
  });

  it("does not verify or sync for a non-google provider", async () => {
    mockAuthHandler.mockResolvedValueOnce(responseWithSession(200, { redirect: false, token: "t" }));

    await POST(route(googleLoginRequest("github")));

    expect(mockVerifyGoogle).not.toHaveBeenCalled();
    expect(mockBackfillImage).not.toHaveBeenCalled();
  });

  it("skips sync when the login itself fails", async () => {
    mockAuthHandler.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }));

    const res = await POST(route(googleLoginRequest("google")));

    expect(res.status).toBe(401);
    expect(mockBackfillImage).not.toHaveBeenCalled();
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

    const res = await GET(route(req));

    expect(res.status).toBe(302);
    expect(mockBackfillImage).toHaveBeenCalledWith(res, null);
  });

  it("does not sync for unrelated auth routes", async () => {
    mockAuthHandler.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const req = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "pw" }),
    });

    await POST(route(req));

    expect(mockBackfillImage).not.toHaveBeenCalled();
  });

  it("still returns the handler response when the image sync throws", async () => {
    mockAuthHandler.mockImplementationOnce(() => {
      throw new Response(null, { status: 302, headers: { location: "http://localhost/", "set-cookie": SESSION_COOKIE } });
    });
    mockBackfillImage.mockRejectedValueOnce(new Error("boom"));

    const res = await GET(route(new Request("http://localhost/api/auth/callback/google?code=x", { method: "GET" })));

    expect(res.status).toBe(302);
  });
});