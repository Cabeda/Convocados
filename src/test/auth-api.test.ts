import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Increase default timeout — players API now awaits notification queue drain
// which adds DB queries per player operation, slow on CI runners
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

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
import { POST as claimPlayerEndpoint } from "~/pages/api/events/[id]/claim-player";
import { PUT as reorderPlayers } from "~/pages/api/events/[id]/reorder-players";
import { POST as undoRemove } from "~/pages/api/events/[id]/undo-remove";
import { GET as getMyGames } from "~/pages/api/me/games";
import { GET as getUserProfile, PATCH as patchUserProfile } from "~/pages/api/users/[id]";
import { PATCH as patchHistory } from "~/pages/api/events/[id]/history/[historyId]";

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
    return { isOwner, isAdmin: false, session: s };
  });
  return session;
}

function mockAnonymous() {
  mockGetSession.mockResolvedValue(null);
  mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
}

async function seedHistory(eventId: string, overrides: Record<string, unknown> = {}) {
  return testPrisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(),
      status: "played",
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      editableUntil: new Date(Date.now() + 86400_000),
      ...overrides,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockAnonymous();
  await resetApiRateLimitStore();
  await testPrisma.appPushToken.deleteMany();
  await testPrisma.pushSubscription.deleteMany();
  await testPrisma.notificationJob.deleteMany();
  await testPrisma.webhookSubscription.deleteMany();
  await testPrisma.playerRating.deleteMany();
  await testPrisma.gameHistory.deleteMany();
  await testPrisma.teamResult.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.eventLog.deleteMany();
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
    const _ownedId = await seedEvent({ ownerId: user.id });
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

// ─── POST /api/events/[id]/claim-player (authenticated) ─────────────────────

describe("POST /api/events/[id]/claim-player", () => {
  it("claims an anonymous player: renames to user name and links userId", async () => {
    const user = await seedUser({ name: "Test User" });
    mockAuth(user.id, user.name);
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: "Anon", eventId: id } });
    const res = await claimPlayerEndpoint(ctx({ id }, { playerId: p.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.claimedPlayerId).toBe(p.id);
    // Verify: player is renamed and linked
    const player = await testPrisma.player.findUnique({ where: { id: p.id } });
    expect((player as any)?.userId).toBe(user.id);
    expect(player?.name).toBe("Test User");
  });

  it("returns 409 when user already has a linked player in the event", async () => {
    const user = await seedUser({ name: "Test User" });
    mockAuth(user.id, user.name);
    const id = await seedEvent();
    // User already has a linked player
    await testPrisma.player.create({ data: { name: "Test User", eventId: id, userId: user.id } as any });
    // Anonymous player to claim
    const anon = await testPrisma.player.create({ data: { name: "Anon", eventId: id } });
    const res = await claimPlayerEndpoint(ctx({ id }, { playerId: anon.id }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already have a linked player");
    // Verify: anon is still anonymous, both players still exist
    const anonPlayer = await testPrisma.player.findUnique({ where: { id: anon.id } });
    expect((anonPlayer as any)?.userId).toBeNull();
    const allPlayers = await testPrisma.player.findMany({ where: { eventId: id } });
    expect(allPlayers).toHaveLength(2);
  });

  it("returns 409 when target player is already linked", async () => {
    const user = await seedUser();
    const other = await seedUser({ name: "Other", email: "other@test.com" });
    mockAuth(user.id);
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: other.name, eventId: id, userId: other.id } as any });
    const res = await claimPlayerEndpoint(ctx({ id }, { playerId: p.id }));
    expect(res.status).toBe(409);
  });

  it("returns 401 for anonymous users", async () => {
    mockAnonymous();
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: "Anon", eventId: id } });
    const res = await claimPlayerEndpoint(ctx({ id }, { playerId: p.id }));
    expect(res.status).toBe(401);
  });

  it("returns 404 for nonexistent event", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await claimPlayerEndpoint(ctx({ id: "nonexistent" }, { playerId: "abc" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for nonexistent player", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const res = await claimPlayerEndpoint(ctx({ id }, { playerId: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("renames PlayerRating to user name when claiming", async () => {
    const user = await seedUser({ name: "Test User" });
    mockAuth(user.id, user.name);
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: "Anon", eventId: id } });
    await testPrisma.playerRating.create({ data: { eventId: id, name: "Anon", rating: 1200 } });
    const res = await claimPlayerEndpoint(ctx({ id }, { playerId: p.id }));
    expect(res.status).toBe(200);
    // Old name rating should be gone
    const oldRating = await testPrisma.playerRating.findUnique({ where: { eventId_name: { eventId: id, name: "Anon" } } });
    expect(oldRating).toBeNull();
    // New name rating should exist with the ELO carried over
    const newRating = await testPrisma.playerRating.findUnique({ where: { eventId_name: { eventId: id, name: "Test User" } } });
    expect(newRating?.userId).toBe(user.id);
    expect(newRating?.rating).toBe(1200);
  });

  it("updates GameHistory teamsSnapshot when claiming anonymous player", async () => {
    const user = await seedUser({ name: "Test User" });
    mockAuth(user.id, user.name);
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: "Anon", eventId: id } });

    // Create game history with the anonymous name in the snapshot
    const snapshot = JSON.stringify([
      { team: "Ninjas", players: [{ name: "Anon", order: 0 }, { name: "Alice", order: 1 }] },
      { team: "Gunas", players: [{ name: "Bob", order: 0 }, { name: "Charlie", order: 1 }] },
    ]);
    const h = await testPrisma.gameHistory.create({
      data: {
        eventId: id,
        dateTime: new Date(),
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        teamsSnapshot: snapshot,
        editableUntil: new Date(Date.now() + 86400_000),
        scoreOne: 3,
        scoreTwo: 1,
        eloProcessed: true,
      },
    });

    const res = await claimPlayerEndpoint(ctx({ id }, { playerId: p.id }));
    expect(res.status).toBe(200);

    // Verify: snapshot should now contain the user's name instead of "Anon"
    const updated = await testPrisma.gameHistory.findUnique({ where: { id: h.id } });
    const parsed = JSON.parse(updated!.teamsSnapshot!);
    const allNames = parsed.flatMap((t: any) => t.players.map((p: any) => p.name));
    expect(allNames).toContain("Test User");
    expect(allNames).not.toContain("Anon");
  });

  it("preserves ELO rating after recalculateAllRatings following a claim", async () => {
    const user = await seedUser({ name: "Test User" });
    mockAuth(user.id, user.name);
    const id = await seedEvent();
    const p = await testPrisma.player.create({ data: { name: "Anon", eventId: id } });

    // Create a played game with scores and snapshot
    const snapshot = JSON.stringify([
      { team: "Ninjas", players: [{ name: "Anon", order: 0 }] },
      { team: "Gunas", players: [{ name: "Bob", order: 0 }] },
    ]);
    await testPrisma.gameHistory.create({
      data: {
        eventId: id,
        dateTime: new Date(),
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        teamsSnapshot: snapshot,
        editableUntil: new Date(Date.now() + 86400_000),
        scoreOne: 3,
        scoreTwo: 1,
        eloProcessed: true,
      },
    });

    // Create the rating that would exist from the processed game
    await testPrisma.playerRating.create({ data: { eventId: id, name: "Anon", rating: 1020, gamesPlayed: 1, wins: 1 } });
    await testPrisma.playerRating.create({ data: { eventId: id, name: "Bob", rating: 980, gamesPlayed: 1, losses: 1 } });

    // Claim the anonymous player
    const res = await claimPlayerEndpoint(ctx({ id }, { playerId: p.id }));
    expect(res.status).toBe(200);

    // Now recalculate all ratings from scratch (replays from snapshots)
    const { recalculateAllRatings } = await import("~/lib/elo.server");
    await recalculateAllRatings(id);

    // After recalculation, the rating should be under "Test User", not "Anon"
    const joseRating = await testPrisma.playerRating.findUnique({
      where: { eventId_name: { eventId: id, name: "Test User" } },
    });
    expect(joseRating).not.toBeNull();
    expect(joseRating!.gamesPlayed).toBe(1);
    expect(joseRating!.wins).toBe(1);

    // "Anon" should not exist
    const anonRating = await testPrisma.playerRating.findUnique({
      where: { eventId_name: { eventId: id, name: "Anon" } },
    });
    expect(anonRating).toBeNull();
  });
});

// ─── PUT /api/events/[id]/reorder-players ───────────────────────────────────

function putCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

describe("PUT /api/events/[id]/reorder-players", () => {
  it("returns 403 on ownerless events (owner required)", async () => {
    mockAnonymous();
    const id = await seedEvent(); // no owner
    const p1 = await testPrisma.player.create({ data: { name: "Alice", eventId: id, order: 0 } });
    const p2 = await testPrisma.player.create({ data: { name: "Bob", eventId: id, order: 1 } });
    const p3 = await testPrisma.player.create({ data: { name: "Charlie", eventId: id, order: 2 } });
    const res = await reorderPlayers(putCtx({ id }, { playerIds: [p3.id, p2.id, p1.id] }));
    expect(res.status).toBe(403);
  });

  it("allows owner to reorder on owned events", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const p1 = await testPrisma.player.create({ data: { name: "Alice", eventId: id, order: 0 } });
    const p2 = await testPrisma.player.create({ data: { name: "Bob", eventId: id, order: 1 } });
    const res = await reorderPlayers(putCtx({ id }, { playerIds: [p2.id, p1.id] }));
    expect(res.status).toBe(200);
    const players = await testPrisma.player.findMany({ where: { eventId: id }, orderBy: { order: "asc" } });
    expect(players.map((p) => p.name)).toEqual(["Bob", "Alice"]);
  });

  it("returns 403 when non-owner tries to reorder on owned event", async () => {
    const owner = await seedUser();
    const other = await seedUser({ name: "Other", email: "other@test.com" });
    mockAuth(other.id);
    const id = await seedEvent({ ownerId: owner.id });
    const p1 = await testPrisma.player.create({ data: { name: "Alice", eventId: id, order: 0 } });
    const p2 = await testPrisma.player.create({ data: { name: "Bob", eventId: id, order: 1 } });
    const res = await reorderPlayers(putCtx({ id }, { playerIds: [p2.id, p1.id] }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when playerIds don't match current players", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    await testPrisma.player.create({ data: { name: "Alice", eventId: id, order: 0 } });
    const res = await reorderPlayers(putCtx({ id }, { playerIds: ["fake-id"] }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for nonexistent event", async () => {
    mockAnonymous();
    const res = await reorderPlayers(putCtx({ id: "nonexistent" }, { playerIds: [] }));
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/events/[id]/undo-remove ──────────────────────────────────────

describe("POST /api/events/[id]/undo-remove", () => {
  it("restores a removed player at their original position", async () => {
    mockAnonymous();
    const id = await seedEvent();
    await testPrisma.player.create({ data: { name: "Alice", eventId: id, order: 0 } });
    await testPrisma.player.create({ data: { name: "Bob", eventId: id, order: 1 } });
    await testPrisma.player.create({ data: { name: "Charlie", eventId: id, order: 2 } });
    // Simulate removing Bob (order 1) and then undoing
    await testPrisma.player.deleteMany({ where: { eventId: id, name: "Bob" } });
    // Re-index: Alice=0, Charlie=1
    await testPrisma.player.updateMany({ where: { eventId: id, name: "Charlie" }, data: { order: 1 } });

    const res = await undoRemove(ctx({ id }, { name: "Bob", order: 1, userId: null, removedAt: Date.now() }));
    expect(res.status).toBe(200);
    const players = await testPrisma.player.findMany({ where: { eventId: id }, orderBy: { order: "asc" } });
    expect(players.map((p) => p.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("returns 410 when undo window has expired", async () => {
    mockAnonymous();
    const id = await seedEvent();
    const res = await undoRemove(ctx({ id }, { name: "Bob", order: 0, userId: null, removedAt: Date.now() - 120_000 }));
    expect(res.status).toBe(410);
  });

  it("returns 409 when player name already exists", async () => {
    mockAnonymous();
    const id = await seedEvent();
    await testPrisma.player.create({ data: { name: "Alice", eventId: id, order: 0 } });
    const res = await undoRemove(ctx({ id }, { name: "Alice", order: 0, userId: null, removedAt: Date.now() }));
    expect(res.status).toBe(409);
  });

  it("returns 404 for nonexistent event", async () => {
    mockAnonymous();
    const res = await undoRemove(ctx({ id: "nonexistent" }, { name: "Bob", order: 0, userId: null, removedAt: Date.now() }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid undo data", async () => {
    mockAnonymous();
    const id = await seedEvent();
    const res = await undoRemove(ctx({ id }, { name: "", order: "bad" }));
    expect(res.status).toBe(400);
  });
});

// ─── PATCH /api/events/[id]/history/[historyId] (authenticated) ──────────────

describe("PATCH /api/events/[id]/history/[historyId]", () => {
  it("returns 401 when not authenticated", async () => {
    mockAnonymous();
    const id = await seedEvent();
    const history = await seedHistory(id);
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 3, scoreTwo: 1 }));
    expect(res.status).toBe(401);
  });

  it("updates a history entry when authenticated", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const history = await seedHistory(id);
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 3, scoreTwo: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoreOne).toBe(3);
    expect(body.scoreTwo).toBe(1);
  });

  it("returns 404 for unknown event", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await patchHistory(patchCtx({ id: "nonexistent", historyId: "x" }, { scoreOne: 1 }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown history entry", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const res = await patchHistory(patchCtx({ id, historyId: "nonexistent" }, { scoreOne: 1 }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when entry is no longer editable", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const history = await seedHistory(id, { editableUntil: new Date(Date.now() - 1000) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 3 }));
    expect(res.status).toBe(403);
  });

  it("triggers ELO processing when scores are set", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 2, scoreTwo: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eloUpdates).toBeTruthy();
    expect(body.eloUpdates.length).toBe(2);
    const updated = await testPrisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(updated?.eloProcessed).toBe(true);
  });

  it("returns 403 when event has owner and request is not from owner or participant", async () => {
    const owner = await seedUser();
    const other = await seedUser({ name: "Outsider" });
    mockAuth(other.id, "Outsider");
    const id = await seedEvent({ ownerId: owner.id });
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 1 }));
    expect(res.status).toBe(403);
  });

  it("allows a participant to edit even if not owner", async () => {
    const owner = await seedUser();
    const participant = await seedUser({ name: "Alice" });
    mockAuth(participant.id, "Alice");
    const id = await seedEvent({ ownerId: owner.id });
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 2, scoreTwo: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoreOne).toBe(2);
  });

  it("allows a claimed player to edit even if name doesn't match teamsSnapshot", async () => {
    const owner = await seedUser();
    const claimedUser = await seedUser({ name: "Different Name" });
    mockAuth(claimedUser.id, "Different Name");
    const id = await seedEvent({ ownerId: owner.id });
    // Add a player claimed by this user
    await testPrisma.player.create({
      data: { name: "Alice", order: 0, eventId: id, userId: claimedUser.id },
    });
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { scoreOne: 3, scoreTwo: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoreOne).toBe(3);
  });

  it("returns 403 when participant tries to edit teams", async () => {
    const owner = await seedUser();
    const participant = await seedUser({ name: "Alice" });
    mockAuth(participant.id, "Alice");
    const id = await seedEvent({ ownerId: owner.id });
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });
    const newTeams = [
      { team: "A", players: [{ name: "Alice", order: 0 }, { name: "Charlie", order: 1 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { teamsSnapshot: newTeams }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("owner or admin");
  });

  it("returns 403 when participant tries to edit payments", async () => {
    const owner = await seedUser();
    const participant = await seedUser({ name: "Alice" });
    mockAuth(participant.id, "Alice");
    const id = await seedEvent({ ownerId: owner.id });
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, {
      paymentsSnapshot: [{ playerName: "Alice", amount: 10, status: "paid" }],
    }));
    expect(res.status).toBe(403);
  });

  it("allows owner to edit teams", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });
    const newTeams = [
      { team: "A", players: [{ name: "Alice", order: 0 }, { name: "Charlie", order: 1 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { teamsSnapshot: newTeams }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = JSON.parse(body.teamsSnapshot);
    expect(parsed[0].players).toHaveLength(2);
  });

  it("auto-updates payments when teams change", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });

    // Set up cost with 2 players
    const eventCost = await testPrisma.eventCost.create({
      data: { eventId: id, totalAmount: 40, currency: "EUR" },
    });
    await testPrisma.playerPayment.createMany({
      data: [
        { eventCostId: eventCost.id, playerName: "Alice", amount: 20, status: "paid" },
        { eventCostId: eventCost.id, playerName: "Bob", amount: 20, status: "pending" },
      ],
    });

    const teams = [
      { team: "A", players: [{ name: "Alice", order: 0 }] },
      { team: "B", players: [{ name: "Bob", order: 0 }] },
    ];
    const history = await seedHistory(id, { teamsSnapshot: JSON.stringify(teams) });

    // Update teams: add Charlie, remove Bob
    const newTeams = [
      { team: "A", players: [{ name: "Alice", order: 0 }, { name: "Charlie", order: 1 }] },
      { team: "B", players: [{ name: "Diana", order: 0 }] },
    ];
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { teamsSnapshot: newTeams }));
    expect(res.status).toBe(200);

    // Verify payments were updated
    const payments = await testPrisma.playerPayment.findMany({
      where: { eventCostId: eventCost.id },
      orderBy: { playerName: "asc" },
    });

    // Should have 3 players now (Alice, Charlie, Diana) — Bob removed
    expect(payments).toHaveLength(3);
    const names = payments.map((p) => p.playerName);
    expect(names).toContain("Alice");
    expect(names).toContain("Charlie");
    expect(names).toContain("Diana");
    expect(names).not.toContain("Bob");

    // Each should have equal share: 40/3
    const expectedShare = Math.round((40 / 3) * 100) / 100;
    // Alice's existing "paid" status should be preserved
    const alice = payments.find((p) => p.playerName === "Alice")!;
    expect(alice.status).toBe("paid");
    // Amount updated to new share
    expect(Math.abs(alice.amount - expectedShare)).toBeLessThan(0.02);
  });

  it("handles status change to cancelled", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const history = await seedHistory(id);
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { status: "cancelled" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("cancelled");
  });

  it("updates paymentsSnapshot", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(id);
    const payments = [
      { playerName: "Alice", amount: 10, status: "paid", method: "revolut" },
      { playerName: "Bob", amount: 10, status: "pending", method: null },
    ];
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { paymentsSnapshot: payments }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentsSnapshot).toBeTruthy();
    const parsed = JSON.parse(body.paymentsSnapshot);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].playerName).toBe("Alice");
    expect(parsed[0].status).toBe("paid");
    expect(parsed[1].status).toBe("pending");
  });

  it("clears paymentsSnapshot when set to null", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const payments = JSON.stringify([{ playerName: "Alice", amount: 10, status: "paid", method: null }]);
    const history = await seedHistory(id, { paymentsSnapshot: payments });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { paymentsSnapshot: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentsSnapshot).toBeNull();
  });

  it("allows owner to unlock an expired history entry", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(id, { editableUntil: new Date(Date.now() - 1000) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { unlock: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.editable).toBe(true);
    expect(new Date(body.editableUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 403 when non-owner tries to unlock", async () => {
    const owner = await seedUser();
    const other = await seedUser({ name: "Outsider" });
    mockAuth(other.id, "Outsider");
    const id = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(id, { editableUntil: new Date(Date.now() - 1000) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { unlock: true }));
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated user tries to unlock", async () => {
    mockAnonymous();
    const id = await seedEvent();
    const history = await seedHistory(id, { editableUntil: new Date(Date.now() - 1000) });
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { unlock: true }));
    expect(res.status).toBe(401);
  });

  it("allows owner to lock an editable history entry", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(id);
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { lock: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.editable).toBe(false);
    expect(new Date(body.editableUntil).getTime()).toBeLessThan(Date.now());
  });

  it("returns 403 when non-owner tries to lock", async () => {
    const owner = await seedUser();
    const other = await seedUser({ name: "Outsider" });
    mockAuth(other.id, "Outsider");
    const id = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(id);
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { lock: true }));
    expect(res.status).toBe(403);
  });

  it("updates teamsSnapshot", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(id);
    const newTeams = [
      { team: "Red", players: [{ name: "Alice", order: 0 }, { name: "Charlie", order: 1 }] },
      { team: "Blue", players: [{ name: "Bob", order: 0 }] },
    ];
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { teamsSnapshot: newTeams }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = JSON.parse(body.teamsSnapshot);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].team).toBe("Red");
    expect(parsed[0].players).toHaveLength(2);
  });

  it("recalculates ratings when teams are updated on an already-processed game", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });

    // Create players with initial ratings
    await testPrisma.playerRating.create({
      data: { eventId: id, name: "Alice", rating: 1000, gamesPlayed: 0 },
    });
    await testPrisma.playerRating.create({
      data: { eventId: id, name: "Bob", rating: 1000, gamesPlayed: 0 },
    });
    await testPrisma.playerRating.create({
      data: { eventId: id, name: "Charlie", rating: 1000, gamesPlayed: 0 },
    });

    const originalTeams = [
      { team: "T1", players: [{ name: "Alice", order: 0 }] },
      { team: "T2", players: [{ name: "Bob", order: 0 }] },
    ];

    // Create a game that has already been ELO-processed
    const history = await seedHistory(id, {
      scoreOne: 3,
      scoreTwo: 1,
      teamsSnapshot: JSON.stringify(originalTeams),
      eloProcessed: true,
    });

    // Process ELO for the original game so ratings reflect Alice vs Bob
    const { processGame } = await import("~/lib/elo.server");
    await processGame(id, history.id, originalTeams, 3, 1);

    // Capture ratings after initial processing
    const aliceBefore = await testPrisma.playerRating.findUnique({
      where: { eventId_name: { eventId: id, name: "Alice" } },
    });
    const charlieBefore = await testPrisma.playerRating.findUnique({
      where: { eventId_name: { eventId: id, name: "Charlie" } },
    });
    expect(aliceBefore!.gamesPlayed).toBeGreaterThan(0);
    // Charlie hasn't played yet
    expect(charlieBefore!.gamesPlayed).toBe(0);

    // Now update teams: swap Bob for Charlie
    const newTeams = [
      { team: "T1", players: [{ name: "Alice", order: 0 }] },
      { team: "T2", players: [{ name: "Charlie", order: 0 }] },
    ];
    const res = await patchHistory(patchCtx({ id, historyId: history.id }, { teamsSnapshot: newTeams }));
    expect(res.status).toBe(200);

    // After updating teams on a processed game, ratings should be recalculated
    // Charlie should now have games played (he replaced Bob)
    const charlieAfter = await testPrisma.playerRating.findUnique({
      where: { eventId_name: { eventId: id, name: "Charlie" } },
    });
    expect(charlieAfter!.gamesPlayed).toBeGreaterThan(0);

    // Bob should no longer have a rating record (recalculation wiped it since
    // he's not in any game's teams anymore)
    const bobAfter = await testPrisma.playerRating.findUnique({
      where: { eventId_name: { eventId: id, name: "Bob" } },
    });
    expect(bobAfter).toBeNull();
  });
});

// ─── PUT /api/events/[id]/duration (auth check #249) ────────────────────────

import { PUT as updateDuration } from "~/pages/api/events/[id]/duration";

describe("PUT /api/events/[id]/duration", () => {
  it("allows owner to update duration", async () => {
    const owner = await seedUser();
    mockAuth(owner.id);
    const id = await seedEvent({ ownerId: owner.id });
    const res = await updateDuration(ctx({ id }, { durationMinutes: 90 }, "PUT"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.durationMinutes).toBe(90);
  });

  it("returns 403 when non-owner tries to update duration on owned event", async () => {
    const owner = await seedUser();
    const other = await seedUser({ name: "Other" });
    mockAuth(other.id, "Other");
    const id = await seedEvent({ ownerId: owner.id });
    const res = await updateDuration(ctx({ id }, { durationMinutes: 90 }, "PUT"));
    expect(res.status).toBe(403);
  });

  it("allows anyone to update duration on ownerless event", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const id = await seedEvent();
    const res = await updateDuration(ctx({ id }, { durationMinutes: 45 }, "PUT"));
    expect(res.status).toBe(200);
  });
});

// ─── PUT /api/events/[id]/split-costs (#192) ────────────────────────────────

import { PUT as updateSplitCosts } from "~/pages/api/events/[id]/split-costs";

function putCtx2(params: Record<string, string>, body: unknown) {
  return ctx(params, body, "PUT");
}

describe("PUT /api/events/[id]/split-costs", () => {
  it("returns 404 for unknown event", async () => {
    const res = await updateSplitCosts(putCtx2({ id: "nonexistent" }, { splitCostsEnabled: false }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when event has owner and request is not from owner", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    mockAnonymous();
    const res = await updateSplitCosts(putCtx2({ id }, { splitCostsEnabled: false }));
    expect(res.status).toBe(403);
  });

  it("allows owner to disable split costs", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id });
    mockAuth(user.id);
    const res = await updateSplitCosts(putCtx2({ id }, { splitCostsEnabled: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.splitCostsEnabled).toBe(false);
    // Verify in DB
    const event = await testPrisma.event.findUnique({ where: { id } });
    expect(event!.splitCostsEnabled).toBe(false);
  });

  it("allows owner to re-enable split costs", async () => {
    const user = await seedUser();
    const id = await seedEvent({ ownerId: user.id, splitCostsEnabled: false });
    mockAuth(user.id);
    const res = await updateSplitCosts(putCtx2({ id }, { splitCostsEnabled: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.splitCostsEnabled).toBe(true);
  });

  it("allows ownerless event to toggle split costs", async () => {
    const id = await seedEvent();
    mockAnonymous();
    const res = await updateSplitCosts(putCtx2({ id }, { splitCostsEnabled: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.splitCostsEnabled).toBe(false);
  });
});

// ─── GET /api/me/games — archived games (#193) ─────────────────────────────

describe("GET /api/me/games — archived games", () => {
  it("separates active and archived owned games", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    await seedEvent({ ownerId: user.id, title: "Active Game" });
    await seedEvent({ ownerId: user.id, title: "Archived Game", archivedAt: new Date() });
    const res = await getMyGames(ctx({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owned).toHaveLength(1);
    expect(body.owned[0].title).toBe("Active Game");
    expect(body.archivedOwned).toHaveLength(1);
    expect(body.archivedOwned[0].title).toBe("Archived Game");
    expect(body.archivedOwned[0].archivedAt).toBeTruthy();
  });

  it("separates active and archived joined games", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const activeId = await seedEvent({ title: "Active Joined" });
    const archivedId = await seedEvent({ title: "Archived Joined", archivedAt: new Date() });
    await testPrisma.player.create({ data: { name: user.name, eventId: activeId, userId: user.id } });
    await testPrisma.player.create({ data: { name: user.name, eventId: archivedId, userId: user.id } });
    const res = await getMyGames(ctx({}));
    const body = await res.json();
    expect(body.joined).toHaveLength(1);
    expect(body.joined[0].title).toBe("Active Joined");
    expect(body.archivedJoined).toHaveLength(1);
    expect(body.archivedJoined[0].title).toBe("Archived Joined");
  });

  it("returns empty archived arrays when no archived games exist", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    await seedEvent({ ownerId: user.id });
    const res = await getMyGames(ctx({}));
    const body = await res.json();
    expect(body.archivedOwned).toHaveLength(0);
    expect(body.archivedJoined).toHaveLength(0);
  });
});
