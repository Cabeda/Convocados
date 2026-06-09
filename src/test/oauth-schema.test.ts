import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";

beforeEach(async () => {
  await prisma.$executeRawUnsafe("DELETE FROM oauthConsent");
  await prisma.$executeRawUnsafe("DELETE FROM oauthAccessToken");
  await prisma.$executeRawUnsafe("DELETE FROM oauthRefreshToken");
  await prisma.$executeRawUnsafe("DELETE FROM oauthClient");
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
    const app = await prisma.oauthClient.create({
      data: {
        id: crypto.randomUUID(),
        name: "Test App",
        clientId: "test-client-id",
        clientSecret: "hashed-secret",
        redirectUris: JSON.stringify(["https://example.com/callback"]),
        type: "web",
        userId: "oauth-test-user-1",
        updatedAt: new Date(),
      },
    });
    expect(app.clientId).toBe("test-client-id");
    expect(app.type).toBe("web");
    expect(app.disabled).toBe(false);
    expect(JSON.parse(app.redirectUris)).toEqual(["https://example.com/callback"]);
  });

  it("creates a public (native) client without a secret", async () => {
    const app = await prisma.oauthClient.create({
      data: {
        id: crypto.randomUUID(),
        name: "Mobile App",
        clientId: "mobile-client-id",
        redirectUris: JSON.stringify(["com.convocados.app://callback"]),
        type: "native",
        updatedAt: new Date(),
      },
    });
    expect(app.clientSecret).toBeNull();
    expect(app.type).toBe("native");
    expect(app.userId).toBeNull();
  });

  it("enforces unique clientId", async () => {
    await prisma.oauthClient.create({
      data: {
        id: crypto.randomUUID(),
        name: "App 1",
        clientId: "dup-client-id",
        redirectUris: "",
        type: "web",
        updatedAt: new Date(),
      },
    });
    await expect(
      prisma.oauthClient.create({
        data: {
          id: crypto.randomUUID(),
          name: "App 2",
          clientId: "dup-client-id",
          redirectUris: "",
          type: "web",
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("cascades delete when user is deleted", async () => {
    await prisma.oauthClient.create({
      data: {
        id: crypto.randomUUID(),
        name: "User App",
        clientId: "user-app-id",
        redirectUris: "",
        type: "web",
        userId: "oauth-test-user-1",
        updatedAt: new Date(),
      },
    });
    await prisma.user.delete({ where: { id: "oauth-test-user-1" } });
    const app = await prisma.oauthClient.findUnique({
      where: { clientId: "user-app-id" },
    });
    expect(app).toBeNull();
  });
});

describe("OAuth 2.1 schema — OauthAccessToken", () => {
  beforeEach(async () => {
    await prisma.oauthClient.create({
      data: {
        id: crypto.randomUUID(),
        name: "Token Test App",
        clientId: "token-test-client",
        redirectUris: "",
        type: "web",
        updatedAt: new Date(),
      },
    });
  });

  it("creates an access token with expiry", async () => {
    const now = new Date();
    const token = await prisma.oauthAccessToken.create({
      data: {
        id: crypto.randomUUID(),
        token: "at_test_123",
        expiresAt: new Date(now.getTime() + 3600_000),
        clientId: "token-test-client",
        userId: "oauth-test-user-1",
        scopes: "openid read:events",
      },
    });
    expect(token.token).toBe("at_test_123");
    expect(token.scopes).toBe("openid read:events");
    expect(token.expiresAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("enforces unique token", async () => {
    const data = {
      id: crypto.randomUUID(),
      token: "at_dup",
      expiresAt: new Date(),
      clientId: "token-test-client",
      scopes: "openid",
    };
    await prisma.oauthAccessToken.create({ data });
    await expect(
      prisma.oauthAccessToken.create({
        data: { ...data, id: crypto.randomUUID() },
      }),
    ).rejects.toThrow();
  });

  it("enforces unique refresh token", async () => {
    const data = {
      id: crypto.randomUUID(),
      token: "rt_dup",
      expiresAt: new Date(),
      clientId: "token-test-client",
      userId: "oauth-test-user-1",
      scopes: "openid",
    };
    await prisma.oauthRefreshToken.create({ data });
    await expect(
      prisma.oauthRefreshToken.create({
        data: { ...data, id: crypto.randomUUID() },
      }),
    ).rejects.toThrow();
  });

  it("cascades delete when client is deleted", async () => {
    await prisma.oauthAccessToken.create({
      data: {
        id: crypto.randomUUID(),
        token: "at_cascade",
        expiresAt: new Date(),
        clientId: "token-test-client",
        scopes: "openid",
      },
    });
    await prisma.oauthClient.delete({
      where: { clientId: "token-test-client" },
    });
    const token = await prisma.oauthAccessToken.findUnique({
      where: { token: "at_cascade" },
    });
    expect(token).toBeNull();
  });
});

describe("OAuth 2.1 schema — OauthConsent", () => {
  beforeEach(async () => {
    await prisma.oauthClient.create({
      data: {
        id: crypto.randomUUID(),
        name: "Consent Test App",
        clientId: "consent-test-client",
        redirectUris: "",
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
    await prisma.oauthClient.delete({
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
