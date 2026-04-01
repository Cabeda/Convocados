import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { GET as getUserStats } from "~/pages/api/users/[id]/stats";
import { GET as getProfile, PATCH as patchProfile } from "~/pages/api/users/[id]/index";

function statsCtx(userId: string) {
  const request = new Request(`http://localhost/api/users/${userId}/stats`, { method: "GET" });
  return { request, params: { id: userId }, url: new URL(`http://localhost/api/users/${userId}/stats`) } as any;
}

function profileCtx(userId: string) {
  const request = new Request(`http://localhost/api/users/${userId}`, { method: "GET" });
  return { request, params: { id: userId } } as any;
}

function patchCtx(userId: string, body: unknown) {
  const request = new Request(`http://localhost/api/users/${userId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: { id: userId } } as any;
}

async function seedUser(id: string, name: string, email: string, publicStats = false) {
  const profileVisibility = publicStats ? "public" : "private";
  await prisma.user.upsert({
    where: { id },
    create: { id, name, email, emailVerified: true, publicStats, profileVisibility },
    update: { publicStats, profileVisibility },
  });
}

async function seedEventWithRatings(ownerId: string | null, title: string, userId: string, userName: string, stats: { rating: number; gamesPlayed: number; wins: number; draws: number; losses: number }) {
  const event = await prisma.event.create({
    data: {
      title,
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId,
    },
  });

  await prisma.playerRating.create({
    data: {
      eventId: event.id,
      name: userName,
      userId,
      rating: stats.rating,
      gamesPlayed: stats.gamesPlayed,
      wins: stats.wins,
      draws: stats.draws,
      losses: stats.losses,
    },
  });

  return event;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── GET /api/users/[id]/stats ──────────────────────────────────────────────

describe("GET /api/users/[id]/stats", () => {
  it("returns 403 when user has publicStats disabled", async () => {
    await seedUser("user1", "Test User", "test@test.com", false);
    mockGetSession.mockResolvedValueOnce(null);

    const res = await getUserStats(statsCtx("user1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns stats when user has publicStats enabled", async () => {
    await seedUser("user1", "Test User", "test@test.com", true);
    await seedEventWithRatings(null, "Event A", "user1", "Test User", {
      rating: 1100, gamesPlayed: 10, wins: 6, draws: 2, losses: 2,
    });
    mockGetSession.mockResolvedValueOnce(null);

    const res = await getUserStats(statsCtx("user1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGames).toBe(10);
    expect(body.events).toHaveLength(1);
  });

  it("returns stats to the user themselves even when publicStats is disabled", async () => {
    await seedUser("user1", "Test User", "test@test.com", false);
    await seedEventWithRatings(null, "Event A", "user1", "Test User", {
      rating: 1000, gamesPlayed: 5, wins: 3, draws: 1, losses: 1,
    });
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User" },
      session: {},
    } as any);

    const res = await getUserStats(statsCtx("user1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGames).toBe(5);
  });

  it("returns 404 for non-existent user", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await getUserStats(statsCtx("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for participants-only when viewer shares no event", async () => {
    await seedUser("user1", "Test User", "test@test.com", false);
    await prisma.user.update({ where: { id: "user1" }, data: { profileVisibility: "participants" } });
    await prisma.user.upsert({
      where: { id: "viewer1" },
      create: { id: "viewer1", name: "Viewer", email: "viewer@test.com", emailVerified: true },
      update: {},
    });
    mockGetSession.mockResolvedValueOnce({ user: { id: "viewer1" } } as any);
    const res = await getUserStats(statsCtx("user1"));
    expect(res.status).toBe(403);
  });

  it("returns 200 for participants-only when viewer shares an event", async () => {
    await seedUser("user1", "Test User", "test@test.com", false);
    await prisma.user.update({ where: { id: "user1" }, data: { profileVisibility: "participants" } });
    await prisma.user.upsert({
      where: { id: "viewer1" },
      create: { id: "viewer1", name: "Viewer", email: "viewer@test.com", emailVerified: true },
      update: {},
    });
    // Create a shared event
    const event = await prisma.event.create({ data: { title: "Shared", location: "X", dateTime: new Date() } });
    await prisma.player.create({ data: { eventId: event.id, name: "Test User", userId: "user1", order: 0 } });
    await prisma.player.create({ data: { eventId: event.id, name: "Viewer", userId: "viewer1", order: 1 } });
    mockGetSession.mockResolvedValueOnce({ user: { id: "viewer1" } } as any);
    const res = await getUserStats(statsCtx("user1"));
    expect(res.status).toBe(200);
  });

  it("returns 403 for participants-only when viewer is unauthenticated", async () => {
    await seedUser("user1", "Test User", "test@test.com", false);
    await prisma.user.update({ where: { id: "user1" }, data: { profileVisibility: "participants" } });
    mockGetSession.mockResolvedValueOnce(null);
    const res = await getUserStats(statsCtx("user1"));
    expect(res.status).toBe(403);
  });
});

// ─── PATCH /api/users/[id] — publicStats toggle ────────────────────────────

describe("PATCH /api/users/[id] — publicStats toggle", () => {
  it("allows user to enable publicStats", async () => {
    await seedUser("user1", "Test User", "test@test.com", false);
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User", email: "test@test.com" },
      session: {},
    } as any);

    const res = await patchProfile(patchCtx("user1", { name: "Test User", publicStats: true }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: "user1" } });
    expect(user!.publicStats).toBe(true);
  });

  it("allows user to disable publicStats", async () => {
    await seedUser("user1", "Test User", "test@test.com", true);
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User", email: "test@test.com" },
      session: {},
    } as any);

    const res = await patchProfile(patchCtx("user1", { name: "Test User", publicStats: false }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: "user1" } });
    expect(user!.publicStats).toBe(false);
  });

  it("does not change publicStats when not provided", async () => {
    await seedUser("user1", "Test User", "test@test.com", true);
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User", email: "test@test.com" },
      session: {},
    } as any);

    const res = await patchProfile(patchCtx("user1", { name: "Updated Name" }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: "user1" } });
    expect(user!.publicStats).toBe(true);
  });

  it("allows user to set profileVisibility to participants", async () => {
    await seedUser("user1", "Test User", "test@test.com", true);
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User", email: "test@test.com" },
      session: {},
    } as any);

    const res = await patchProfile(patchCtx("user1", { name: "Test User", profileVisibility: "participants" }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: "user1" }, select: { profileVisibility: true } });
    expect(user!.profileVisibility).toBe("participants");
  });

  it("ignores invalid profileVisibility values", async () => {
    await seedUser("user1", "Test User", "test@test.com", true);
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User", email: "test@test.com" },
      session: {},
    } as any);

    const res = await patchProfile(patchCtx("user1", { name: "Test User", profileVisibility: "invalid" }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: "user1" }, select: { profileVisibility: true } });
    expect(user!.profileVisibility).toBe("public"); // unchanged
  });
});

// ─── GET /api/users/[id] — publicStats in profile ──────────────────────────

describe("GET /api/users/[id] — publicStats in profile", () => {
  it("includes publicStats for own profile", async () => {
    await seedUser("user1", "Test User", "test@test.com", true);
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User", email: "test@test.com" },
      session: {},
    } as any);

    const res = await getProfile(profileCtx("user1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicStats).toBe(true);
  });

  it("includes publicStats for other users (so visitors know if stats link is available)", async () => {
    await seedUser("user1", "Test User", "test@test.com", true);
    mockGetSession.mockResolvedValueOnce(null);

    const res = await getProfile(profileCtx("user1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicStats).toBe(true);
  });

  it("returns publicStats false for other users when disabled", async () => {
    await seedUser("user1", "Test User", "test@test.com", false);
    mockGetSession.mockResolvedValueOnce(null);

    const res = await getProfile(profileCtx("user1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicStats).toBe(false);
  });
});
