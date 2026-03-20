import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Mock auth helpers
const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

// Mock logger to avoid noise
vi.mock("~/lib/logger.server", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Ensure route handlers use the same prisma client
vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

// Import route handlers AFTER mocking
import { GET as exportData } from "~/pages/api/me/export";
import { DELETE as deleteAccount } from "~/pages/api/me/account";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCtx() {
  const request = new Request("http://localhost/api/me/export", { method: "GET" });
  return { request, params: {} } as any;
}

function deleteCtx(body?: unknown) {
  const request = new Request("http://localhost/api/me/account", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params: {} } as any;
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return testPrisma.user.create({
    data: {
      id,
      name: "Test User",
      email: `${id}@test.com`,
      emailVerified: false,
      ...overrides,
    },
  });
}

function mockAuth(userId: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, name: "Test User", email: `${userId}@test.com` },
  });
}

function mockAnonymous() {
  mockGetSession.mockResolvedValue(null);
}

/** Seed a credential (email+password) account for a user */
async function seedCredentialAccount(userId: string, plainPassword: string) {
  const hashed = await hashPassword(plainPassword);
  return testPrisma.account.create({
    data: {
      id: `acc-${userId}`,
      accountId: userId,
      providerId: "credential",
      userId,
      password: hashed,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockAnonymous();
  // Clean up in correct order (respect FK constraints)
  await testPrisma.notificationPreferences.deleteMany();
  await testPrisma.playerRating.deleteMany();
  await testPrisma.gameHistory.deleteMany();
  await testPrisma.teamResult.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.calendarToken.deleteMany();
  await testPrisma.apiKey.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
});

// ─── GET /api/me/export ─────────────────────────────────────────────────────

describe("GET /api/me/export", () => {
  it("returns 401 for unauthenticated users", async () => {
    mockAnonymous();
    const res = await exportData(getCtx());
    expect(res.status).toBe(401);
  });

  it("returns user data as JSON with Content-Disposition header", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    // Seed some related data
    const event = await testPrisma.event.create({
      data: {
        title: "Test Event",
        location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
        ownerId: user.id,
      },
    });
    await testPrisma.player.create({
      data: { name: user.name, eventId: event.id, userId: user.id },
    });
    await testPrisma.calendarToken.create({
      data: { token: "cal-token-123", userId: user.id },
    });

    const res = await exportData(getCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Type")).toBe("application/json");

    const body = await res.json();
    expect(body.exportedAt).toBeTruthy();
    expect(body.user.id).toBe(user.id);
    expect(body.user.email).toBe(user.email);
    expect(body.ownedEvents).toHaveLength(1);
    expect(body.players).toHaveLength(1);
    expect(body.calendarTokens).toHaveLength(1);
  });

  it("returns empty arrays when user has no related data", async () => {
    const user = await seedUser();
    mockAuth(user.id);

    const res = await exportData(getCtx());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.user.id).toBe(user.id);
    expect(body.ownedEvents).toHaveLength(0);
    expect(body.players).toHaveLength(0);
    expect(body.sessions).toHaveLength(0);
    expect(body.calendarTokens).toHaveLength(0);
    expect(body.apiKeys).toHaveLength(0);
    expect(body.playerRatings).toHaveLength(0);
    expect(body.accounts).toHaveLength(0);
  });
});

// ─── DELETE /api/me/account ─────────────────────────────────────────────────

describe("DELETE /api/me/account", () => {
  it("returns 401 for unauthenticated users", async () => {
    mockAnonymous();
    const res = await deleteAccount(deleteCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when password is wrong", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    await seedCredentialAccount(user.id, "correctPassword1");

    const res = await deleteAccount(deleteCtx({ password: "wrongPassword" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Invalid password");

    // Verify user still exists
    const existing = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(existing).not.toBeNull();
  });

  it("returns 400 when password is missing for credential user", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    await seedCredentialAccount(user.id, "myPassword123");

    const res = await deleteAccount(deleteCtx({}));
    expect(res.status).toBe(400);

    // Verify user still exists
    const existing = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(existing).not.toBeNull();
  });

  it("deletes the user with correct password and cleans up all data", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    await seedCredentialAccount(user.id, "correctPassword1");

    // Seed related data
    const event = await testPrisma.event.create({
      data: {
        title: "Test Event",
        location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
        ownerId: user.id,
      },
    });
    await testPrisma.player.create({
      data: { name: user.name, eventId: event.id, userId: user.id },
    });
    await testPrisma.calendarToken.create({
      data: { token: `cal-${user.id}`, userId: user.id },
    });
    await testPrisma.playerRating.create({
      data: { eventId: event.id, name: user.name, userId: user.id, rating: 1000 },
    });

    const res = await deleteAccount(deleteCtx({ password: "correctPassword1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify user is gone
    const deletedUser = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(deletedUser).toBeNull();

    // Verify event ownership was nullified (event still exists)
    const updatedEvent = await testPrisma.event.findUnique({ where: { id: event.id } });
    expect(updatedEvent).not.toBeNull();
    expect(updatedEvent!.ownerId).toBeNull();

    // Verify player was unlinked (still exists but userId is null)
    const player = await testPrisma.player.findFirst({ where: { eventId: event.id, name: user.name } });
    expect(player).not.toBeNull();
    expect(player!.userId).toBeNull();

    // Verify calendar token was deleted
    const tokens = await testPrisma.calendarToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(0);

    // Verify player rating was unlinked
    const rating = await testPrisma.playerRating.findFirst({ where: { eventId: event.id, name: user.name } });
    expect(rating).not.toBeNull();
    expect(rating!.userId).toBeNull();
  });

  it("allows social-only user to delete without password", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    // No credential account — social-only user

    const res = await deleteAccount(deleteCtx({}));
    expect(res.status).toBe(200);

    const deletedUser = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(deletedUser).toBeNull();
  });

  it("nullifies ownership of multiple events", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    // Social-only user (no password needed)

    const event1 = await testPrisma.event.create({
      data: { title: "Event 1", location: "A", dateTime: new Date(Date.now() + 86400_000), ownerId: user.id },
    });
    const event2 = await testPrisma.event.create({
      data: { title: "Event 2", location: "B", dateTime: new Date(Date.now() + 86400_000), ownerId: user.id },
    });

    const res = await deleteAccount(deleteCtx());
    expect(res.status).toBe(200);

    const e1 = await testPrisma.event.findUnique({ where: { id: event1.id } });
    const e2 = await testPrisma.event.findUnique({ where: { id: event2.id } });
    expect(e1!.ownerId).toBeNull();
    expect(e2!.ownerId).toBeNull();
  });
});
