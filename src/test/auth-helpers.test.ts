import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { getSession, checkEventAdmin, checkOwnership } from "~/lib/auth.helpers.server";
import { auth } from "~/lib/auth.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/auth.server")>();
  return {
    ...actual,
    auth: {
      ...actual.auth,
      api: {
        ...actual.auth.api,
        getSession: vi.fn(),
      },
    },
  };
});

beforeEach(async () => {
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthApplication.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.resetAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(null as any);
});

async function seedOAuthApp(clientId = "client1") {
  return prisma.oauthApplication.create({
    data: {
      name: "Test App",
      clientId,
      redirectUrls: "[]",
      type: "web",
    },
  });
}

describe("getSession", () => {
  it("returns null for missing auth header", async () => {
    const req = new Request("http://localhost");
    const res = await getSession(req);
    expect(res).toBeNull();
    expect(auth.api.getSession).toHaveBeenCalled();
  });

  it("falls back to session cookie when no bearer token", async () => {
    const req = new Request("http://localhost", { headers: { cookie: "session=abc" } });
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    const res = await getSession(req);
    expect(res).toEqual({ user: { id: "u1" } });
  });

  it("returns null for invalid OAuth token", async () => {
    const req = new Request("http://localhost", { headers: { authorization: "Bearer invalid" } });
    const res = await getSession(req);
    expect(res).toBeNull();
  });

  it("returns null for expired OAuth token", async () => {
    const user = await prisma.user.create({
      data: { id: "u-oauth", name: "OAuth User", email: "oauth@test.com", emailVerified: true },
    });
    await seedOAuthApp();
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "expired_token",
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshToken: "refresh",
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
        userId: user.id,
        clientId: "client1",
        scopes: "read",
      },
    });
    const req = new Request("http://localhost", { headers: { authorization: "Bearer expired_token" } });
    const res = await getSession(req);
    expect(res).toBeNull();
  });

  it("returns user session for valid OAuth token", async () => {
    const user = await prisma.user.create({
      data: { id: "u-oauth2", name: "OAuth User 2", email: "oauth2@test.com", emailVerified: true },
    });
    await seedOAuthApp();
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "valid_token",
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshToken: "refresh",
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
        userId: user.id,
        clientId: "client1",
        scopes: "read",
      },
    });
    const req = new Request("http://localhost", { headers: { authorization: "Bearer valid_token" } });
    const res = await getSession(req);
    expect(res).not.toBeNull();
    expect(res?.user.id).toBe(user.id);
  });

  it("skips OAuth path for apiKey tokens (cvk_ prefix)", async () => {
    const req = new Request("http://localhost", { headers: { authorization: "Bearer cvk_abc123" } });
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    const res = await getSession(req);
    expect(res).toEqual({ user: { id: "u1" } });
  });
});

describe("checkEventAdmin", () => {
  it("returns false when no admin record exists", async () => {
    const res = await checkEventAdmin("evt1", "user1");
    expect(res).toBe(false);
  });

  it("returns true when admin record exists", async () => {
    const user = await prisma.user.create({
      data: { id: "u-admin", name: "Admin", email: "admin@test.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { id: "evt-admin", title: "Admin Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
    });
    await prisma.eventAdmin.create({
      data: { eventId: event.id, userId: user.id },
    });
    const res = await checkEventAdmin(event.id, user.id);
    expect(res).toBe(true);
  });
});

describe("checkOwnership", () => {
  it("returns isOwner=true for event owner", async () => {
    const user = await prisma.user.create({
      data: { id: "u-owner", name: "Owner", email: "owner@test.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { id: "evt-owner", title: "Owner Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId: user.id },
    });
    const req = new Request("http://localhost", { headers: { authorization: "Bearer valid_token" } });
    await seedOAuthApp();
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "valid_token",
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshToken: "refresh",
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
        userId: user.id,
        clientId: "client1",
        scopes: "read",
      },
    });
    const res = await checkOwnership(req, event.ownerId, null, event.id);
    expect(res.isOwner).toBe(true);
    expect(res.isAdmin).toBe(false);
  });

  it("returns isAdmin=true for event admin (not owner)", async () => {
    const owner = await prisma.user.create({
      data: { id: "u-owner2", name: "Owner", email: "owner2@test.com", emailVerified: true },
    });
    const admin = await prisma.user.create({
      data: { id: "u-admin2", name: "Admin", email: "admin2@test.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { id: "evt-admin2", title: "Admin Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId: owner.id },
    });
    await prisma.eventAdmin.create({
      data: { eventId: event.id, userId: admin.id },
    });
    const req = new Request("http://localhost", { headers: { authorization: "Bearer admin_token" } });
    await seedOAuthApp();
    await prisma.oauthAccessToken.create({
      data: {
        accessToken: "admin_token",
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshToken: "refresh",
        refreshTokenExpiresAt: new Date(Date.now() + 3600000),
        userId: admin.id,
        clientId: "client1",
        scopes: "read",
      },
    });
    const res = await checkOwnership(req, event.ownerId, null, event.id);
    expect(res.isOwner).toBe(false);
    expect(res.isAdmin).toBe(true);
  });

  it("returns isOwner=false and isAdmin=false for anonymous user", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-anon", title: "Anon Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId: null },
    });
    const req = new Request("http://localhost");
    const res = await checkOwnership(req, event.ownerId, null, event.id);
    expect(res.isOwner).toBe(false);
    expect(res.isAdmin).toBe(false);
    expect(res.session).toBeFalsy();
  });

  it("uses existing session when provided", async () => {
    const user = await prisma.user.create({
      data: { id: "u-existing", name: "Existing", email: "existing@test.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { id: "evt-existing", title: "Existing Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId: user.id },
    });
    const existingSession = { user: { id: user.id, name: user.name } } as any;
    const req = new Request("http://localhost");
    const res = await checkOwnership(req, event.ownerId, existingSession, event.id);
    expect(res.isOwner).toBe(true);
    expect(res.session).toEqual(existingSession);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });
});
