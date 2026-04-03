import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";

beforeEach(async () => {
  await prisma.$executeRawUnsafe("DELETE FROM OauthConsent");
  await prisma.$executeRawUnsafe("DELETE FROM OauthAccessToken");
  await prisma.$executeRawUnsafe("DELETE FROM OauthApplication");
  await prisma.$executeRawUnsafe("DELETE FROM User WHERE id LIKE 'oauth-test-%'");
  await prisma.user.create({
    data: {
      id: "oauth-test-user-1",
      name: "OAuth Test User",
      email: "oauth-test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
});

describe("OAuth 2.1 schema — OauthApplication", () => {
  it("creates a web client with all fields", async () => {
    const app = await prisma.oauthApplication.create({
      data: {
        name: "Test App",
        clientId: "test-client-id",
        clientSecret: "hashed-secret",
        redirectUrls: JSON.stringify(["https://example.com/callback"]),
        type: "web",
        userId: "oauth-test-user-1",
        updatedAt: new Date(),
      },
    });
    expect(app.clientId).toBe("test-client-id");
    expect(app.type).toBe("web");
    expect(app.disabled).toBe(false);
    expect(JSON.parse(app.redirectUrls)).toEqual(["https://example.com/callback"]);
  });

  it("creates a public (native) client without a secret", async () => {
    const app = await prisma.oauthApplication.create({
      data: {
        name: "Mobile App",
        clientId: "mobile-client-id",
        redirectUrls: JSON.stringify(["com.convocados.app://callback"]),
        type: "native",
        updatedAt: new Date(),
      },
    });
    expect(app.clientSecret).toBeNull();
    expect(app.type).toBe("native");
    expect(app.userId).toBeNull();
  });

  it("enforces unique clientId", async () => {
    await prisma.oauthApplication.create({
      data: {
        name: "App 1",
        clientId: "dup-client-id",
        redirectUrls: "[]",
        type: "web",
        updatedAt: new Date(),
      },
    });
    await expect(
      prisma.oauthApplication.create({
        data: {
          name: "App 2",
          clientId: "dup-client-id",
          redirectUrls: "[]",
          type: "web",
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("cascades delete when user is deleted", async () => {
    await prisma.oauthApplication.create({
      data: {
        name: "User App",
        clientId: "user-app-id",
        redirectUrls: "[]",
        type: "web",
        userId: "oauth-test-user-1",
        updatedAt: new Date(),
      },
    });
    await prisma.user.delete({ where: { id: "oauth-test-user-1" } });
    const app = await prisma.oauthApplication.findUnique({
      where: { clientId: "user-app-id" },
    });
    expect(app).toBeNull();
  });
});

describe("OAuth 2.1 schema — OauthAccessToken", () => {
  beforeEach(async () => {
    await prisma.oauthApplication.create({
      data: {
        name: "Token Test App",
        clientId: "token-test-client",
        redirectUrls: "[]",
        type: "web",
        updatedAt: new Date(),
      },
    });
  });

  it("creates an access token with expiry", async () => {
    const now = new Date();
    const token = await prisma.oauthAccessToken.create({
      data: {
        accessToken: "at_test_123",
        refreshToken: "rt_test_123",
        accessTokenExpiresAt: new Date(now.getTime() + 3600_000),
        refreshTokenExpiresAt: new Date(now.getTime() + 604800_000),
        clientId: "token-test-client",
        userId: "oauth-test-user-1",
        scopes: "openid read:events",
        updatedAt: now,
      },
    });
    expect(token.accessToken).toBe("at_test_123");
    expect(token.scopes).toBe("openid read:events");
    expect(token.accessTokenExpiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("enforces unique accessToken", async () => {
    const data = {
      accessToken: "at_dup",
      refreshToken: "rt_unique_1",
      accessTokenExpiresAt: new Date(),
      refreshTokenExpiresAt: new Date(),
      clientId: "token-test-client",
      scopes: "openid",
      updatedAt: new Date(),
    };
    await prisma.oauthAccessToken.create({ data });
    await expect(
      prisma.oauthAccessToken.create({
        data: { ...data, refreshToken: "rt_unique_2" },
      }),
    ).rejects.toThrow();
  });

  it("enforces unique refreshToken", async () => {
    const data = {
      accessToken: "at_unique_1",
      refreshToken: "rt_dup",
      accessTokenExpiresAt: new Date(),
      refreshTokenExpiresAt: new Date(),
      clientId: "token-test-client",
      scopes: "openid",
      updatedAt: new Date(),
    };
    await prisma.oauthAccessToken.create({ data });
    await expect(
      prisma.oauthAccessToken.create({
        data: { ...data, accessToken: "at_unique_2" },
      }),
    ).rejects.toThrow();
  });

  it("cascades delete when client is deleted", async () => {
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "at_cascade",
        refreshToken: "rt_cascade",
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
        clientId: "token-test-client",
        scopes: "openid",
        updatedAt: new Date(),
      },
    });
    await prisma.oauthApplication.delete({
      where: { clientId: "token-test-client" },
    });
    const token = await prisma.oauthAccessToken.findUnique({
      where: { accessToken: "at_cascade" },
    });
    expect(token).toBeNull();
  });
});

describe("OAuth 2.1 schema — OauthConsent", () => {
  beforeEach(async () => {
    await prisma.oauthApplication.create({
      data: {
        name: "Consent Test App",
        clientId: "consent-test-client",
        redirectUrls: "[]",
        type: "web",
        updatedAt: new Date(),
      },
    });
  });

  it("creates a consent record", async () => {
    const consent = await prisma.oauthConsent.create({
      data: {
        clientId: "consent-test-client",
        userId: "oauth-test-user-1",
        scopes: "openid read:events",
        consentGiven: true,
        updatedAt: new Date(),
      },
    });
    expect(consent.consentGiven).toBe(true);
    expect(consent.scopes).toBe("openid read:events");
  });

  it("cascades delete when client is deleted", async () => {
    const consent = await prisma.oauthConsent.create({
      data: {
        clientId: "consent-test-client",
        userId: "oauth-test-user-1",
        scopes: "openid",
        consentGiven: true,
        updatedAt: new Date(),
      },
    });
    await prisma.oauthApplication.delete({
      where: { clientId: "consent-test-client" },
    });
    const found = await prisma.oauthConsent.findUnique({
      where: { id: consent.id },
    });
    expect(found).toBeNull();
  });

  it("cascades delete when user is deleted", async () => {
    const consent = await prisma.oauthConsent.create({
      data: {
        clientId: "consent-test-client",
        userId: "oauth-test-user-1",
        scopes: "openid",
        consentGiven: true,
        updatedAt: new Date(),
      },
    });
    await prisma.user.delete({ where: { id: "oauth-test-user-1" } });
    const found = await prisma.oauthConsent.findUnique({
      where: { id: consent.id },
    });
    expect(found).toBeNull();
  });
});
