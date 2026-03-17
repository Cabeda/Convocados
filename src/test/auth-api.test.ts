import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Use a separate Prisma client for test data setup (avoids mock interference)
const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Mock auth helpers to simulate authenticated sessions
const mockGetSession = vi.fn();
const mockCheckOwnership = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: (...args: any[]) => mockCheckOwnership(...args),
}));

// Ensure route handlers use the same prisma client
vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

// Import route handlers AFTER mocking
import { POST as claimOwnership, DELETE as relinquishOwnership } from "~/pages/api/events/[id]/claim";
import { POST as transferOwnership } from "~/pages/api/events/[id]/transfer";
import { POST as addPlayer, DELETE as deletePlayer } from "~/pages/api/events/[id]/players";
import { GET as getMyGames } from "~/pages/api/me/games";
import { GET as getUserProfile, PATCH as patchUserProfile } from "~/pages/api/users/[id]";

// ── Helpers ──────────────────────────────────────────────────────────────────

function ctx(params: Record<string, string>, body?: unknown, method = "GET") {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? (method === "GET" ? "POST" : method) : method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function deleteCtx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function patchCtx(params: Record<string, string>, body: unknown) {
  return ctx(params, body, "PATCH");
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return (await testPrisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ...overrides,
    },
  })).id;
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

function mockAuth(userId: string, userName = "Test User") {
  const session = { user: { id: userId, name: userName, email: `${userId}@test.com` } };
  mockGetSession.mockResolvedValue(session);
  mockCheckOwnership.mockImplementation(async (_req: any, ownerId: string | null, existing?: any) => {
    const s = existing ?? session;
    const isOwner = !!(s?.user && ownerId && s.user.id === ownerId);
    return { isOwner, session: s };
  });
  return session;
}

function mockAnonymous() {
  mockGetSession.mockResolvedValue(null);
  mockCheckOwnership.mockResolvedValue({ isOwner: false, session: null });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockAnonymous();
  await testPrisma.pushSubscription.deleteMany();
  await testPrisma.webhookSubscription.deleteMany();
  await testPrisma.playerRating.deleteMany();
  await testPrisma.gameHistory.deleteMany();
  await testPrisma.teamResult.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
});

// ─── POST /api/events/[id]/claim (authenticated) ────────────────────────────

describe("POST /api/events/[id]/claim (authenticated)", () => {
  it("claims ownership of an ownerless event", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const res = await claimOwnership(ctx({ id }, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ownerId).toBe(user.id);
    // Verify in DB
    const event = await testPrisma.event.findUnique({ where: { id } });
    expect(event?.ownerId).toBe(user.id);
  });

  it("returns 409 when event already has an owner", async () => {
    const owner = await seedUser();
    const claimer = await seedUser({ name: "Claimer", email: "claimer@test.com" });
    mockAuth(claimer.id);
    const id = await seedEvent({ ownerId: owner.id });
    const res = await claimOwnership(ctx({ id }, {}));
    expect(res.status).toBe(409);
  });

  it("returns 404 for nonexistent event after atomic claim fails", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await claimOwnership(ctx({ id: "nonexistent" }, {}));
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/events/[id]/claim (authenticated) ───────────────────────────

describe("DELETE /api/events/[id]/claim (authenticated)", () => {
  it("relinquishes ownership", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent({ ownerId: user.id });
    const res = await relinquishOwnership(deleteCtx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ownerId).toBeNull();
    const event = await testPrisma.event.findUnique({ where: { id } });
    expect(event?.ownerId).toBeNull();
  });

  it("returns 403 when not the owner", async () => {
    const owner = await seedUser();
    const other = await seedUser({ name: "Other", email: "other@test.com" });
    mockAuth(other.id);
    const id = await seedEvent({ ownerId: owner.id });
    const res = await relinquishOwnership(deleteCtx({ id }));
    expect(res.status).toBe(403);
  });

  it("returns 404 for nonexistent event", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await relinquishOwnership(deleteCtx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/events/[id]/transfer (authenticated) ─────────────────────────

describe("POST /api/events/[id]/transfer (authenticated)", () => {
  it("transfers ownership to another authenticated player", async () => {
    const owner = await seedUser();
    const target = await seedUser({ name: "Target", email: "target@test.com" });
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    await testPrisma.player.create({ data: { name: target.name, eventId: id, userId: target.id } });
    const res = await transferOwnership(ctx({ id }, { targetUserId: target.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ownerId).toBe(target.id);
  });

  it("returns 400 when targetUserId is missing", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const res = await transferOwnership(ctx({ id }, { targetUserId: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when target is not a player in the event", async () => {
    const owner = await seedUser();
    const target = await seedUser({ name: "Target", email: "target@test.com" });
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const res = await transferOwnership(ctx({ id }, { targetUserId: target.id }));
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/events/[id]/players (linkToAccount) ──────────────────────────

describe("POST /api/events/[id]/players (linkToAccount)", () => {
  it("links userId when linkToAccount is true and user is authenticated", async () => {
    const user = await seedUser();
    mockAuth(user.id, user.name);
    const id = await seedEvent();
    const res = await addPlayer(ctx({ id }, { name: user.name, linkToAccount: true }));
    expect(res.status).toBe(200);
    const player = await testPrisma.player.findFirst({ where: { eventId: id, name: user.name } });
    expect(player?.userId).toBe(user.id);
  });

  it("does not link userId when linkToAccount is false", async () => {
    const user = await seedUser();
    mockAuth(user.id, user.name);
    const id = await seedEvent();
    const res = await addPlayer(ctx({ id }, { name: user.name, linkToAccount: false }));
    expect(res.status).toBe(200);
    const player = await testPrisma.player.findFirst({ where: { eventId: id, name: user.name } });
    expect(player?.userId).toBeNull();
  });

  it("does not link userId for anonymous users even with linkToAccount", async () => {
    mockAnonymous();
    const id = await seedEvent();
    const res = await addPlayer(ctx({ id }, { name: "Anon", linkToAccount: true }));
    expect(res.status).toBe(200);
    const player = await testPrisma.player.findFirst({ where: { eventId: id, name: "Anon" } });
    expect(player?.userId).toBeNull();
  });
});

// ─── DELETE /api/events/[id]/players (protected players) ─────────────────────

describe("DELETE /api/events/[id]/players (protected)", () => {
  it("allows owner to remove a protected player", async () => {
    const owner = await seedUser();
    const player = await seedUser({ name: "Player", email: "player@test.com" });
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const p = await testPrisma.player.create({ data: { name: player.name, eventId: id, userId: player.id } });
    const res = await deletePlayer(deleteCtx({ id }, { playerId: p.id }));
    expect(res.status).toBe(200);
  });

  it("allows self-removal of protected player", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: user.name, eventId: id, userId: user.id } });
    const res = await deletePlayer(deleteCtx({ id }, { playerId: p.id }));
    expect(res.status).toBe(200);
  });

  it("blocks removal of protected player by non-owner non-self", async () => {
    const playerUser = await seedUser();
    const other = await seedUser({ name: "Other", email: "other@test.com" });
    mockAuth(other.id);
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: playerUser.name, eventId: id, userId: playerUser.id } });
    const res = await deletePlayer(deleteCtx({ id }, { playerId: p.id }));
    expect(res.status).toBe(403);
  });

  it("allows anyone to remove an anonymous player", async () => {
    mockAnonymous();
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: "Anon", eventId: id } });
    const res = await deletePlayer(deleteCtx({ id }, { playerId: p.id }));
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/me/games (authenticated) ──────────────────────────────────────

describe("GET /api/me/games (authenticated)", () => {
  it("returns owned and joined games", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const ownedId = await seedEvent({ ownerId: user.id });
    const joinedId = await seedEvent({ title: "Joined Game" });
    await testPrisma.player.create({ data: { name: user.name, eventId: joinedId, userId: user.id } });
    const res = await getMyGames(ctx({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owned).toHaveLength(1);
    expect(body.joined).toHaveLength(1);
  });

  it("deduplicates joined events that are also owned", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent({ ownerId: user.id });
    await testPrisma.player.create({ data: { name: user.name, eventId: id, userId: user.id } });
    const res = await getMyGames(ctx({}));
    const body = await res.json();
    expect(body.owned).toHaveLength(1);
    expect(body.joined).toHaveLength(0);
  });
});

// ─── GET /api/users/[id] (authenticated viewer) ─────────────────────────────

describe("GET /api/users/[id] (authenticated viewer)", () => {
  it("shows email on own profile", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await getUserProfile(ctx({ id: user.id }));
    const body = await res.json();
    expect(body.isOwnProfile).toBe(true);
    expect(body.user.email).toBeTruthy();
  });

  it("shows private events where viewer is also a player", async () => {
    const profileUser = await seedUser();
    const viewer = await seedUser({ name: "Viewer", email: "viewer@test.com" });
    mockAuth(viewer.id);
    const id = await seedEvent({ ownerId: profileUser.id, isPublic: false });
    await testPrisma.player.create({ data: { name: viewer.name, eventId: id, userId: viewer.id } });
    const res = await getUserProfile(ctx({ id: profileUser.id }));
    const body = await res.json();
    expect(body.owned).toHaveLength(1);
  });

  it("hides private events where viewer is not a participant", async () => {
    const profileUser = await seedUser();
    const viewer = await seedUser({ name: "Viewer", email: "viewer@test.com" });
    mockAuth(viewer.id);
    await seedEvent({ ownerId: profileUser.id, isPublic: false });
    const res = await getUserProfile(ctx({ id: profileUser.id }));
    const body = await res.json();
    expect(body.owned).toHaveLength(0);
  });
});

// ─── PATCH /api/users/[id] (authenticated) ──────────────────────────────────

describe("PATCH /api/users/[id] (authenticated)", () => {
  it("updates own name", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await patchUserProfile(patchCtx({ id: user.id }, { name: "New Name" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe("New Name");
  });

  it("returns 400 for empty name", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await patchUserProfile(patchCtx({ id: user.id }, { name: "  " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-string name", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await patchUserProfile(patchCtx({ id: user.id }, { name: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when trying to update another user", async () => {
    const user = await seedUser();
    const other = await seedUser({ name: "Other", email: "other@test.com" });
    mockAuth(user.id);
    const res = await patchUserProfile(patchCtx({ id: other.id }, { name: "Hacked" }));
    expect(res.status).toBe(403);
  });
});
