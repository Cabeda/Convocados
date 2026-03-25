import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { generateApiKey } from "~/lib/apiKey.server";
import { authenticateRequest, requireScope } from "~/lib/authenticate.server";
import type { AuthContext } from "~/lib/authenticate.server";

beforeEach(async () => {
  await prisma.$executeRawUnsafe("DELETE FROM OauthAccessToken");
  await prisma.$executeRawUnsafe("DELETE FROM OauthApplication");
  await prisma.$executeRawUnsafe("DELETE FROM ApiKey");
  await prisma.$executeRawUnsafe("DELETE FROM User WHERE id LIKE 'auth-mw-test-%'");
  await prisma.user.create({
    data: {
      id: "auth-mw-test-user-1",
      name: "Auth MW Test User",
      email: "auth-mw-test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:4321/api/test", { headers });
}

describe("authenticateRequest", () => {
  describe("API key auth", () => {
    it("authenticates a valid API key", async () => {
      const { raw, hashed } = generateApiKey();
      await prisma.apiKey.create({
        data: {
          name: "Test Key",
          hashedKey: hashed,
          prefix: raw.slice(0, 8),
          userId: "auth-mw-test-user-1",
          scopes: JSON.stringify(["read:events", "write:events"]),
        },
      });

      const ctx = await authenticateRequest(
        makeRequest({ authorization: `Bearer ${raw}` }),
      );
      expect(ctx).not.toBeNull();
      expect(ctx!.authMethod).toBe("api_key");
      expect(ctx!.userId).toBe("auth-mw-test-user-1");
      expect(ctx!.scopes).toContain("read:events");
      expect(ctx!.keyId).toBeDefined();
    });

    it("returns null for invalid API key", async () => {
      const ctx = await authenticateRequest(
        makeRequest({ authorization: "Bearer cvk_invalid_key_here" }),
      );
      expect(ctx).toBeNull();
    });
  });

  describe("OAuth bearer token auth", () => {
    beforeEach(async () => {
      await prisma.oauthApplication.create({
        data: {
          name: "Test OAuth App",
          clientId: "auth-mw-oauth-client",
          redirectUrls: "[]",
          type: "web",
          updatedAt: new Date(),
        },
      });
    });

    it("authenticates a valid OAuth token", async () => {
      const now = new Date();
      await prisma.oauthAccessToken.create({
        data: {
          accessToken: "valid_oauth_token",
          refreshToken: "valid_refresh_token",
          accessTokenExpiresAt: new Date(now.getTime() + 3600_000),
          refreshTokenExpiresAt: new Date(now.getTime() + 604800_000),
          clientId: "auth-mw-oauth-client",
          userId: "auth-mw-test-user-1",
          scopes: "openid read:events",
          updatedAt: now,
        },
      });

      const ctx = await authenticateRequest(
        makeRequest({ authorization: "Bearer valid_oauth_token" }),
      );
      expect(ctx).not.toBeNull();
      expect(ctx!.authMethod).toBe("oauth");
      expect(ctx!.userId).toBe("auth-mw-test-user-1");
      expect(ctx!.scopes).toContain("openid");
      expect(ctx!.scopes).toContain("read:events");
      expect(ctx!.clientId).toBe("auth-mw-oauth-client");
    });

    it("rejects an expired OAuth token", async () => {
      const past = new Date(Date.now() - 3600_000);
      await prisma.oauthAccessToken.create({
        data: {
          accessToken: "expired_oauth_token",
          refreshToken: "expired_refresh_token",
          accessTokenExpiresAt: past,
          refreshTokenExpiresAt: past,
          clientId: "auth-mw-oauth-client",
          userId: "auth-mw-test-user-1",
          scopes: "openid",
          updatedAt: past,
        },
      });

      const ctx = await authenticateRequest(
        makeRequest({ authorization: "Bearer expired_oauth_token" }),
      );
      expect(ctx).toBeNull();
    });

    it("rejects an unknown bearer token", async () => {
      const ctx = await authenticateRequest(
        makeRequest({ authorization: "Bearer unknown_token_xyz" }),
      );
      expect(ctx).toBeNull();
    });
  });

  describe("no auth", () => {
    it("returns null when no authorization header is present", async () => {
      const ctx = await authenticateRequest(makeRequest());
      expect(ctx).toBeNull();
    });
  });
});

describe("requireScope", () => {
  it("returns true for session auth (wildcard)", () => {
    const ctx: AuthContext = {
      userId: "u1",
      scopes: ["*"],
      authMethod: "session",
    };
    expect(requireScope(ctx, "read:events")).toBe(true);
    expect(requireScope(ctx, "manage:payments")).toBe(true);
  });

  it("returns true when scope is present", () => {
    const ctx: AuthContext = {
      userId: "u1",
      scopes: ["openid", "read:events"],
      authMethod: "oauth",
    };
    expect(requireScope(ctx, "read:events")).toBe(true);
  });

  it("returns false when scope is missing", () => {
    const ctx: AuthContext = {
      userId: "u1",
      scopes: ["openid", "read:events"],
      authMethod: "oauth",
    };
    expect(requireScope(ctx, "write:events")).toBe(false);
  });

  it("returns false for API key without required scope", () => {
    const ctx: AuthContext = {
      userId: "u1",
      scopes: ["read:events"],
      authMethod: "api_key",
      keyId: "k1",
    };
    expect(requireScope(ctx, "manage:players")).toBe(false);
  });
});
