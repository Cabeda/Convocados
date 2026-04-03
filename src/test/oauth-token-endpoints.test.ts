import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const BASE = "http://localhost:4321";

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.$executeRawUnsafe("DELETE FROM OauthAccessToken");
  await prisma.$executeRawUnsafe("DELETE FROM OauthApplication");
  await prisma.$executeRawUnsafe("DELETE FROM User WHERE id LIKE 'token-ep-test-%'");
  await prisma.user.create({
    data: {
      id: "token-ep-test-user-1",
      name: "Token EP Test User",
      email: "token-ep-test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.oauthApplication.create({
    data: {
      name: "Token EP Test App",
      clientId: "token-ep-client",
      redirectUrls: "[]",
      type: "web",
      updatedAt: new Date(),
    },
  });
});

async function createToken(overrides: Partial<{
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}> = {}) {
  const now = new Date();
  return prisma.oauthAccessToken.create({
    data: {
      accessToken: overrides.accessToken ?? "at_introspect_test",
      refreshToken: overrides.refreshToken ?? "rt_introspect_test",
      accessTokenExpiresAt: overrides.accessTokenExpiresAt ?? new Date(now.getTime() + 3600_000),
      refreshTokenExpiresAt: overrides.refreshTokenExpiresAt ?? new Date(now.getTime() + 604800_000),
      clientId: "token-ep-client",
      userId: "token-ep-test-user-1",
      scopes: "openid read:events",
      updatedAt: now,
    },
  });
}

// Import the route handlers directly
const { POST: introspectHandler } = await import("~/pages/api/auth/oauth2/introspect");
const { POST: revokeHandler } = await import("~/pages/api/auth/oauth2/revoke");

function makeRequest(path: string, body: Record<string, string>): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeFormRequest(path: string, body: Record<string, string>): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

// Minimal Astro APIContext stub
function stubContext(request: Request) {
  return { request, params: {}, redirect: () => new Response() } as any;
}

describe("Token Introspection (RFC 7662)", () => {
  it("returns active:true for a valid access token", async () => {
    await createToken();
    const req = makeRequest("/api/auth/oauth2/introspect", { token: "at_introspect_test" });
    const res = await introspectHandler(stubContext(req));
    const data = await res.json();
    expect(data.active).toBe(true);
    expect(data.scope).toBe("openid read:events");
    expect(data.client_id).toBe("token-ep-client");
    expect(data.sub).toBe("token-ep-test-user-1");
    expect(data.token_type).toBe("access_token");
    expect(data.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("returns active:true for a valid refresh token", async () => {
    await createToken();
    const req = makeRequest("/api/auth/oauth2/introspect", { token: "rt_introspect_test" });
    const res = await introspectHandler(stubContext(req));
    const data = await res.json();
    expect(data.active).toBe(true);
    expect(data.token_type).toBe("refresh_token");
  });

  it("returns active:false for an expired access token", async () => {
    await createToken({
      accessToken: "at_expired",
      refreshToken: "rt_expired",
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    });
    const req = makeRequest("/api/auth/oauth2/introspect", { token: "at_expired" });
    const res = await introspectHandler(stubContext(req));
    const data = await res.json();
    expect(data.active).toBe(false);
  });

  it("returns active:false for an unknown token", async () => {
    const req = makeRequest("/api/auth/oauth2/introspect", { token: "unknown_token" });
    const res = await introspectHandler(stubContext(req));
    const data = await res.json();
    expect(data.active).toBe(false);
  });

  it("returns active:false when no token is provided", async () => {
    const req = makeRequest("/api/auth/oauth2/introspect", {});
    const res = await introspectHandler(stubContext(req));
    const data = await res.json();
    expect(data.active).toBe(false);
  });

  it("supports form-urlencoded content type", async () => {
    await createToken();
    const req = makeFormRequest("/api/auth/oauth2/introspect", { token: "at_introspect_test" });
    const res = await introspectHandler(stubContext(req));
    const data = await res.json();
    expect(data.active).toBe(true);
  });
});

describe("Token Revocation (RFC 7009)", () => {
  it("revokes an access token", async () => {
    await createToken({ accessToken: "at_revoke_test", refreshToken: "rt_revoke_test" });

    const req = makeRequest("/api/auth/oauth2/revoke", { token: "at_revoke_test" });
    const res = await revokeHandler(stubContext(req));
    expect(res.status).toBe(200);

    // Verify token is gone
    const found = await prisma.oauthAccessToken.findFirst({
      where: { accessToken: "at_revoke_test" },
    });
    expect(found).toBeNull();
  });

  it("revokes by refresh token (deletes the whole token record)", async () => {
    await createToken({ accessToken: "at_revoke2", refreshToken: "rt_revoke2" });

    const req = makeRequest("/api/auth/oauth2/revoke", { token: "rt_revoke2" });
    const res = await revokeHandler(stubContext(req));
    expect(res.status).toBe(200);

    // Both access and refresh should be gone
    const found = await prisma.oauthAccessToken.findFirst({
      where: { accessToken: "at_revoke2" },
    });
    expect(found).toBeNull();
  });

  it("returns 200 for an unknown token (per RFC 7009)", async () => {
    const req = makeRequest("/api/auth/oauth2/revoke", { token: "nonexistent" });
    const res = await revokeHandler(stubContext(req));
    expect(res.status).toBe(200);
  });

  it("returns 200 when no token is provided", async () => {
    const req = makeRequest("/api/auth/oauth2/revoke", {});
    const res = await revokeHandler(stubContext(req));
    expect(res.status).toBe(200);
  });

  it("revoked token is rejected by introspection", async () => {
    await createToken({ accessToken: "at_revoke_check", refreshToken: "rt_revoke_check" });

    // Revoke
    await revokeHandler(
      stubContext(makeRequest("/api/auth/oauth2/revoke", { token: "at_revoke_check" })),
    );

    // Introspect should return active:false
    const res = await introspectHandler(
      stubContext(makeRequest("/api/auth/oauth2/introspect", { token: "at_revoke_check" })),
    );
    const data = await res.json();
    expect(data.active).toBe(false);
  });
});
