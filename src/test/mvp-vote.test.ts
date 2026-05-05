import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { POST as castMvpVote } from "~/pages/api/events/[id]/history/[historyId]/mvp-vote";
import { GET as getMvp } from "~/pages/api/events/[id]/history/[historyId]/mvp";

// ── Helpers ──────────────────────────────────────────────────────────────────

function postCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

function getCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", { method: "GET" });
  return { request, params } as any;
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() - 3600_000), // 1 hour ago
      durationMinutes: 30, // ended 30 min ago
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ...overrides,
    },
  });
}

async function seedUser(name = "Test User") {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: { id, name, email: `${id}@test.com`, emailVerified: false },
  });
}

async function seedHistory(eventId: string, overrides: Record<string, unknown> = {}) {
  return prisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(Date.now() - 3600_000),
      status: "played",
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      teamsSnapshot: JSON.stringify([
        { team: "Ninjas", players: [{ name: "Alice", order: 0 }, { name: "Bob", order: 1 }] },
        { team: "Gunas", players: [{ name: "Charlie", order: 0 }, { name: "Dave", order: 1 }] },
      ]),
      editableUntil: new Date(Date.now() + 86400_000),
      ...overrides,
    },
  });
}

async function seedPlayer(eventId: string, name: string, userId?: string) {
  return prisma.player.create({ data: { name, eventId, userId } });
}

function mockAuth(userId: string, userName: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, name: userName, email: `${userId}@test.com` },
  } as any);
}

function mockNoAuth() {
  mockGetSession.mockResolvedValue(null);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockNoAuth();
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.mvpVote.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── POST /api/events/[id]/history/[historyId]/mvp-vote ─────────────────────

describe("POST mvp-vote", () => {
  it("casts a valid vote", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent();
    await seedPlayer(event.id, "Alice", user.id);
    const bob = await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id);

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: bob.id },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.vote.votedForName).toBe("Bob");
  });

  it("rejects unauthenticated request", async () => {
    const event = await seedEvent();
    const bob = await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id);

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: bob.id },
    ));
    expect(res.status).toBe(401);
  });

  it("rejects self-vote", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent();
    const alice = await seedPlayer(event.id, "Alice", user.id);
    const history = await seedHistory(event.id);

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: alice.id },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/yourself/i);
  });

  it("rejects duplicate vote", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent();
    await seedPlayer(event.id, "Alice", user.id);
    const bob = await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id);

    await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: bob.id },
    ));
    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: bob.id },
    ));
    expect(res.status).toBe(409);
  });

  it("sets hasVoted=true after voting via GET mvp endpoint", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent();
    await seedPlayer(event.id, "Alice", user.id);
    const bob = await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id);

    await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: bob.id },
    ));

    const mvpRes = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    const mvpBody = await mvpRes.json();
    expect(mvpBody.hasVoted).toBe(true);
    expect(mvpBody.totalVotes).toBe(1);
  });

  it("get mvp shows hasVoted=false before voting", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent();
    await seedPlayer(event.id, "Alice", user.id);
    await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id);

    const res = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.hasVoted).toBe(false);
    expect(body.totalVotes).toBe(0);
  });

  it("rejects non-participant", async () => {
    const user = await seedUser("Outsider");
    mockAuth(user.id, "Outsider");
    const event = await seedEvent();
    await seedPlayer(event.id, "Alice");
    const bob = await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id);

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: bob.id },
    ));
    expect(res.status).toBe(403);
  });

  it("rejects vote after newer game exists", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent();
    await seedPlayer(event.id, "Alice", user.id);
    const bob = await seedPlayer(event.id, "Bob");
    const oldHistory = await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 7200_000),
    });
    await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 3600_000),
    });

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: oldHistory.id },
      { votedForPlayerId: bob.id },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/closed/i);
  });

  it("rejects vote after 7 days", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent({ dateTime: new Date(Date.now() - 8 * 86400_000) });
    await seedPlayer(event.id, "Alice", user.id);
    const bob = await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 8 * 86400_000),
      createdAt: new Date(Date.now() - 8 * 86400_000),
    });

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: bob.id },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/closed/i);
  });

  it("rejects vote on cancelled game", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent();
    await seedPlayer(event.id, "Alice", user.id);
    const bob = await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id, { status: "cancelled" });

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: bob.id },
    ));
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/events/[id]/history/[historyId]/mvp ───────────────────────────

describe("GET mvp", () => {
  it("returns null mvp when no votes", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);

    const res = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mvp).toBeNull();
    expect(body.isVotingOpen).toBe(true);
    expect(body.hasVoted).toBeNull();
  });

  it("returns correct MVP with votes", async () => {
    const event = await seedEvent();
    const alice = await seedPlayer(event.id, "Alice");
    const bob = await seedPlayer(event.id, "Bob");
    const charlie = await seedPlayer(event.id, "Charlie");
    const history = await seedHistory(event.id);

    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: alice.id, voterName: "Alice",
        votedForPlayerId: bob.id, votedForName: "Bob",
      },
    });
    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: charlie.id, voterName: "Charlie",
        votedForPlayerId: bob.id, votedForName: "Bob",
      },
    });

    const res = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.mvp).toHaveLength(1);
    expect(body.mvp[0].playerName).toBe("Bob");
    expect(body.mvp[0].voteCount).toBe(2);
  });

  it("returns co-MVPs on tie", async () => {
    const event = await seedEvent();
    const alice = await seedPlayer(event.id, "Alice");
    const bob = await seedPlayer(event.id, "Bob");
    const charlie = await seedPlayer(event.id, "Charlie");
    const history = await seedHistory(event.id);

    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: alice.id, voterName: "Alice",
        votedForPlayerId: bob.id, votedForName: "Bob",
      },
    });
    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: bob.id, voterName: "Bob",
        votedForPlayerId: charlie.id, votedForName: "Charlie",
      },
    });

    const res = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.mvp).toHaveLength(2);
    const names = body.mvp.map((m: any) => m.playerName).sort();
    expect(names).toEqual(["Bob", "Charlie"]);
  });

  it("returns hasVoted for authenticated user", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent();
    const alice = await seedPlayer(event.id, "Alice", user.id);
    const bob = await seedPlayer(event.id, "Bob");
    const history = await seedHistory(event.id);

    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: alice.id, voterName: "Alice",
        votedForPlayerId: bob.id, votedForName: "Bob",
      },
    });

    const res = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.hasVoted).toBe(true);
  });

  it("returns isVotingOpen=false after 7 days", async () => {
    const event = await seedEvent({ dateTime: new Date(Date.now() - 8 * 86400_000) });
    const history = await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 8 * 86400_000),
      createdAt: new Date(Date.now() - 8 * 86400_000),
    });

    const res = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.isVotingOpen).toBe(false);
  });

  it("returns isVotingOpen=true after recurrence reset (event.dateTime is future, history.dateTime is past)", async () => {
    // After recurrence reset: event.dateTime advances to next week, but history.dateTime is the old game time
    const event = await seedEvent({ dateTime: new Date(Date.now() + 7 * 86400_000) });
    const history = await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 3600_000), // game was 1h ago
    });

    const res = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.isVotingOpen).toBe(true);
  });

  it("returns participants from teamsSnapshot", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);

    const res = await getMvp(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.participants).toBeDefined();
    expect(body.participants.map((p: any) => p.name).sort()).toEqual(["Alice", "Bob", "Charlie", "Dave"]);
  });
});

describe("POST mvp-vote (name-based)", () => {
  it("accepts name-based vote when Player records are gone (post-reset)", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    // Event dateTime is in the future (post-reset), but history is from the past game
    const event = await seedEvent({ dateTime: new Date(Date.now() + 7 * 86400_000) });
    // Create player record for voter (Alice) — she re-enrolled for next game
    await seedPlayer(event.id, "Alice", user.id);
    const history = await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 3600_000),
    });

    // Vote for Bob by name (no Player record for Bob after reset)
    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: "name:Bob" },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vote.votedForName).toBe("Bob");
  });

  it("rejects name-based self-vote", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent({ dateTime: new Date(Date.now() + 7 * 86400_000) });
    await seedPlayer(event.id, "Alice", user.id);
    const history = await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 3600_000),
    });

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: "name:Alice" },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/yourself/i);
  });

  it("allows vote when voter has no Player record (fully name-based after reset)", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent({ dateTime: new Date(Date.now() + 7 * 86400_000) });
    // No Player records at all — both voter and target resolved by name
    const history = await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 3600_000),
    });

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: "name:Bob" },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vote.votedForName).toBe("Bob");
  });

  it("rejects name-based vote for unknown player", async () => {
    const user = await seedUser("Alice");
    mockAuth(user.id, "Alice");
    const event = await seedEvent({ dateTime: new Date(Date.now() + 7 * 86400_000) });
    const history = await seedHistory(event.id, {
      dateTime: new Date(Date.now() - 3600_000),
    });

    const res = await castMvpVote(postCtx(
      { id: event.id, historyId: history.id },
      { votedForPlayerId: "name:Unknown" },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});
