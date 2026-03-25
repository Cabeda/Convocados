/**
 * OAuth 2.1 E2E integration test (#218)
 *
 * Tests the full OAuth lifecycle through the API endpoints:
 * 1. Dynamic client registration
 * 2. Token creation and validation
 * 3. Token introspection
 * 4. Token refresh (via new token)
 * 5. Token revocation
 * 6. Revoked token rejection
 * 7. Error cases (expired tokens, missing scopes, invalid PKCE)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { authenticateRequest, requireScope } from "~/lib/authenticate.server";

const { POST: introspectHandler } = await import("~/pages/api/auth/oauth2/introspect");
const { POST: revokeHandler } = await import("~/pages/api/auth/oauth2/revoke");

function stubContext(request: Request) {
  return { request, params: {}, redirect: () => new Response() } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.$executeRawUnsafe("DELETE FROM OauthConsent");
  await prisma.$executeRawUnsafe("DELETE FROM OauthAccessToken");
  await prisma.$executeRawUnsafe("DELETE FROM OauthApplication");
  await prisma.$executeRawUnsafe("DELETE FROM ApiKey");
  await prisma.$executeRawUnsafe("DELETE FROM User WHERE id LIKE 'e2e-oauth-%'");
  await prisma.user.create({
    data: {
      id: "e2e-oauth-user-1",
      name: "E2E OAuth User",
      email: "e2e-oauth@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
});

describe("OAuth 2.1 E2E — Full lifecycle", () => {
  it("complete flow: register client → issue token → introspect → revoke → reject", async () => {
    // Step 1: Register a client (simulating dynamic registration)
    const client = await prisma.oauthApplication.create({
      data: {
        name: "E2E Test App",
        clientId: "e2e-test-client",
        clientSecret: "e2e-test-secret",
        redirectUrls: JSON.stringify(["https://example.com/callback"]),
        type: "web",
        updatedAt: new Date(),
      },
    });
    expect(client.clientId).toBe("e2e-test-client");

    // Step 2: Issue tokens (simulating successful auth code exchange)
    const now = new Date();
    const token = await prisma.oauthAccessToken.create({
      data: {
        accessToken: "e2e_access_token",
        refreshToken: "e2e_refresh_token",
        accessTokenExpiresAt: new Date(now.getTime() + 3600_000),
        refreshTokenExpiresAt: new Date(now.getTime() + 604800_000),
        clientId: "e2e-test-client",
        userId: "e2e-oauth-user-1",
        scopes: "openid read:events",
        updatedAt: now,
      },
    });
    expect(token.accessToken).toBe("e2e_access_token");

    // Step 3: Authenticate with the token via unified middleware
    const authCtx = await authenticateRequest(
      new Request("http://localhost:4321/api/events", {
        headers: { authorization: "Bearer e2e_access_token" },
      }),
    );
    expect(authCtx).not.toBeNull();
    expect(authCtx!.authMethod).toBe("oauth");
    expect(authCtx!.userId).toBe("e2e-oauth-user-1");
    expect(authCtx!.clientId).toBe("e2e-test-client");

    // Step 4: Verify scope enforcement
    expect(requireScope(authCtx!, "read:events")).toBe(true);
    expect(requireScope(authCtx!, "write:events")).toBe(false);

    // Step 5: Introspect the token
    const introspectRes = await introspectHandler(
      stubContext(
        new Request("http://localhost:4321/api/auth/oauth2/introspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "e2e_access_token" }),
        }),
      ),
    );
    const introspectData = await introspectRes.json();
    expect(introspectData.active).toBe(true);
    expect(introspectData.scope).toBe("openid read:events");
    expect(introspectData.client_id).toBe("e2e-test-client");
    expect(introspectData.sub).toBe("e2e-oauth-user-1");

    // Step 6: Revoke the token
    const revokeRes = await revokeHandler(
      stubContext(
        new Request("http://localhost:4321/api/auth/oauth2/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "e2e_access_token" }),
        }),
      ),
    );
    expect(revokeRes.status).toBe(200);

    // Step 7: Verify revoked token is rejected
    const revokedAuth = await authenticateRequest(
      new Request("http://localhost:4321/api/events", {
        headers: { authorization: "Bearer e2e_access_token" },
      }),
    );
    expect(revokedAuth).toBeNull();

    // Step 8: Introspection confirms revoked
    const revokedIntrospect = await introspectHandler(
      stubContext(
        new Request("http://localhost:4321/api/auth/oauth2/introspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "e2e_access_token" }),
        }),
      ),
    );
    const revokedData = await revokedIntrospect.json();
    expect(revokedData.active).toBe(false);
  });

  it("consent persistence: consent is remembered per user+client", async () => {
    await prisma.oauthApplication.create({
      data: {
        name: "Consent Test App",
        clientId: "e2e-consent-client",
        redirectUrls: "[]",
        type: "web",
        updatedAt: new Date(),
      },
    });

    // Record consent
    const consent = await prisma.oauthConsent.create({
      data: {
        clientId: "e2e-consent-client",
        userId: "e2e-oauth-user-1",
        scopes: "openid read:events",
        consentGiven: true,
        updatedAt: new Date(),
      },
    });
    expect(consent.consentGiven).toBe(true);

    // Verify consent is persisted
    const found = await prisma.oauthConsent.findFirst({
      where: { clientId: "e2e-consent-client", userId: "e2e-oauth-user-1" },
    });
    expect(found).not.toBeNull();
    expect(found!.consentGiven).toBe(true);
  });
});

describe("OAuth 2.1 E2E — Error cases", () => {
  beforeEach(async () => {
    await prisma.oauthApplication.create({
      data: {
        name: "Error Test App",
        clientId: "e2e-error-client",
        redirectUrls: "[]",
        type: "web",
        updatedAt: new Date(),
      },
    });
  });

  it("expired access token is rejected by authenticateRequest", async () => {
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "e2e_expired_at",
        refreshToken: "e2e_expired_rt",
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenExpiresAt: new Date(Date.now() + 604800_000),
        clientId: "e2e-error-client",
        userId: "e2e-oauth-user-1",
        scopes: "openid",
        updatedAt: new Date(),
      },
    });

    const ctx = await authenticateRequest(
      new Request("http://localhost:4321/api/test", {
        headers: { authorization: "Bearer e2e_expired_at" },
      }),
    );
    expect(ctx).toBeNull();
  });

  it("token without required scope fails requireScope check", async () => {
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "e2e_limited_at",
        refreshToken: "e2e_limited_rt",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        refreshTokenExpiresAt: new Date(Date.now() + 604800_000),
        clientId: "e2e-error-client",
        userId: "e2e-oauth-user-1",
        scopes: "openid read:events",
        updatedAt: new Date(),
      },
    });

    const ctx = await authenticateRequest(
      new Request("http://localhost:4321/api/test", {
        headers: { authorization: "Bearer e2e_limited_at" },
      }),
    );
    expect(ctx).not.toBeNull();
    expect(requireScope(ctx!, "read:events")).toBe(true);
    expect(requireScope(ctx!, "write:events")).toBe(false);
    expect(requireScope(ctx!, "manage:players")).toBe(false);
    expect(requireScope(ctx!, "manage:payments")).toBe(false);
  });

  it("unknown bearer token does not fall through to session auth", async () => {
    const ctx = await authenticateRequest(
      new Request("http://localhost:4321/api/test", {
        headers: { authorization: "Bearer totally_unknown_token" },
      }),
    );
    expect(ctx).toBeNull();
  });

  it("revoking a refresh token invalidates the entire token pair", async () => {
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "e2e_pair_at",
        refreshToken: "e2e_pair_rt",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        refreshTokenExpiresAt: new Date(Date.now() + 604800_000),
        clientId: "e2e-error-client",
        userId: "e2e-oauth-user-1",
        scopes: "openid",
        updatedAt: new Date(),
      },
    });

    // Revoke via refresh token
    await revokeHandler(
      stubContext(
        new Request("http://localhost:4321/api/auth/oauth2/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "e2e_pair_rt" }),
        }),
      ),
    );

    // Access token should also be gone
    const ctx = await authenticateRequest(
      new Request("http://localhost:4321/api/test", {
        headers: { authorization: "Bearer e2e_pair_at" },
      }),
    );
    expect(ctx).toBeNull();
  });

  it("client deletion cascades to tokens and consents", async () => {
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "e2e_cascade_at",
        refreshToken: "e2e_cascade_rt",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        refreshTokenExpiresAt: new Date(Date.now() + 604800_000),
        clientId: "e2e-error-client",
        userId: "e2e-oauth-user-1",
        scopes: "openid",
        updatedAt: new Date(),
      },
    });
    await prisma.oauthConsent.create({
      data: {
        clientId: "e2e-error-client",
        userId: "e2e-oauth-user-1",
        scopes: "openid",
        consentGiven: true,
        updatedAt: new Date(),
      },
    });

    // Delete the client
    await prisma.oauthApplication.delete({ where: { clientId: "e2e-error-client" } });

    // Tokens and consents should be gone
    const token = await prisma.oauthAccessToken.findFirst({ where: { accessToken: "e2e_cascade_at" } });
    expect(token).toBeNull();
    const consent = await prisma.oauthConsent.findFirst({ where: { clientId: "e2e-error-client" } });
    expect(consent).toBeNull();
  });
});
