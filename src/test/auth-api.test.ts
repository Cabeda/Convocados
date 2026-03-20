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
import { POST as claimPlayerEndpoint } from "~/pages/api/events/[id]/claim-player";
import { PUT as reorderPlayers } from "~/pages/api/events/[id]/reorder-players";
import { POST as undoRemove } from "~/pages/api/events/[id]/undo-remove";
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

// ─── POST /api/events/[id]/claim-player (authenticated) ─────────────────────

describe("POST /api/events/[id]/claim-player", () => {
  it("claims an anonymous player: renames to user name and links userId", async () => {
    const user = await seedUser({ name: "José" });
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
    expect(player?.name).toBe("José");
  });

  it("returns 409 when user already has a linked player in the event", async () => {
    const user = await seedUser({ name: "José" });
    mockAuth(user.id, user.name);
    const id = await seedEvent();
    // User already has a linked player
    await testPrisma.player.create({ data: { name: "José", eventId: id, userId: user.id } as any });
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
    const user = await seedUser({ name: "José" });
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
    const newRating = await testPrisma.playerRating.findUnique({ where: { eventId_name: { eventId: id, name: "José" } } });
    expect(newRating?.userId).toBe(user.id);
    expect(newRating?.rating).toBe(1200);
  });

  it("updates GameHistory teamsSnapshot when claiming anonymous player", async () => {
    const user = await seedUser({ name: "José" });
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
    expect(allNames).toContain("José");
    expect(allNames).not.toContain("Anon");
  });

  it("preserves ELO rating after recalculateAllRatings following a claim", async () => {
    const user = await seedUser({ name: "José" });
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

    // After recalculation, the rating should be under "José", not "Anon"
    const joseRating = await testPrisma.playerRating.findUnique({
      where: { eventId_name: { eventId: id, name: "José" } },
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
