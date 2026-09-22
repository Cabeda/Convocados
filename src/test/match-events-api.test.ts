import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { GET as listEvents, POST as createEvent } from "~/pages/api/events/[id]/history/[historyId]/match-events";

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

async function seedUser(name = "Test User") {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: { id, name, email: `${id}@test.com`, emailVerified: false },
  });
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() - 3600_000),
      durationMinutes: 30,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      sport: "football-5v5",
      ...overrides,
    },
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
      ...overrides,
    },
  });
}

function mockAuth(userId: string, userName: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, name: userName, email: `${userId}@test.com` },
  } as any);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.matchEvent.deleteMany();
  await prisma.mvpVote.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.player.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("POST match-events", () => {
  it("requires authentication", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);
    const res = await createEvent(postCtx({ id: event.id, historyId: history.id }, { type: "goal", team: "one", scorerName: "Alice" }));
    expect(res.status).toBe(401);
  });

  it("owner can log a goal for an event player", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    const alice = await prisma.eventPlayer.create({ data: { name: "Alice", eventId: event.id } });

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one", scorerEventPlayerId: alice.id, minute: 12 },
    ));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.event.scorerName).toBe("Alice");
    expect(body.event.team).toBe("one");
    expect(body.score).toEqual({ teamOne: 1, teamTwo: 0 });

    const stored = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(stored?.scoreOne).toBe(1);
    expect(stored?.scoreTwo).toBe(0);
  });

  it("a statistician can log a goal", async () => {
    const user = await seedUser("Stat");
    mockAuth(user.id, "Stat");
    const owner = await seedUser("Owner");
    const event = await seedEvent({ ownerId: owner.id });
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: user.id, role: "statistician" } });
    const history = await seedHistory(event.id);

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "two", scorerName: "Charlie" },
    ));
    expect(res.status).toBe(201);
  });

  it("rejects a non-participant with 403", async () => {
    const stranger = await seedUser("Stranger");
    mockAuth(stranger.id, "Stranger");
    const owner = await seedUser("Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one", scorerName: "Alice" },
    ));
    expect(res.status).toBe(403);
  });

  it("rejects set-based sports", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id, sport: "padel" });
    const history = await seedHistory(event.id);

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one", scorerName: "Alice" },
    ));
    expect(res.status).toBe(400);
  });

  it("credits an own goal to the opposing team", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one", scorerName: "Alice", ownGoal: true },
    ));
    expect(res.status).toBe(201);
    const stored = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(stored?.scoreOne).toBe(0);
    expect(stored?.scoreTwo).toBe(1);
  });

  it("rejects an unknown team for a goal", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "unknown", scorerName: "Alice" },
    ));
    expect(res.status).toBe(400);
  });

  it("rejects a missing scorer name", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one" },
    ));
    expect(res.status).toBe(400);
  });

  it("keeps the manual score when no goals exist", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id, { scoreOne: 3, scoreTwo: 2 });

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "assist", team: "one", scorerName: "Alice", assistName: "Bob" },
    ));
    expect(res.status).toBe(201);
    const stored = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(stored?.scoreOne).toBe(3);
    expect(stored?.scoreTwo).toBe(2);
  });
});

describe("GET match-events", () => {
  it("lists the timeline and derived score", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice" },
    });
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "two", scorerName: "Charlie" },
    });

    const res = await listEvents(getCtx({ id: event.id, historyId: history.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
    expect(body.score).toEqual({ teamOne: 1, teamTwo: 1 });
  });

  it("returns null score when there are no events", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id, { scoreOne: 4, scoreTwo: 1 });

    const res = await listEvents(getCtx({ id: event.id, historyId: history.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(0);
    expect(body.score).toBeNull();
  });
});

describe("POST match-events — bulk count", () => {
  it("stores a count and derives the score from it", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    const alice = await prisma.eventPlayer.create({ data: { name: "Alice", eventId: event.id } });

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one", scorerEventPlayerId: alice.id, count: 3 },
    ));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.event.count).toBe(3);
    expect(body.score).toEqual({ teamOne: 3, teamTwo: 0 });

    const stored = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(stored?.scoreOne).toBe(3);
  });

  it("treats an omitted count as a single goal", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    const alice = await prisma.eventPlayer.create({ data: { name: "Alice", eventId: event.id } });

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one", scorerEventPlayerId: alice.id },
    ));
    const body = await res.json();
    expect(body.event.count).toBe(1);
    expect(body.score).toEqual({ teamOne: 1, teamTwo: 0 });
  });

  it("rejects a count below one", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);

    const res = await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one", scorerName: "Alice", count: 0 },
    ));
    expect(res.status).toBe(400);
  });

  it("keeps a bulk entry as one row that the timeline reports with its count", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    const alice = await prisma.eventPlayer.create({ data: { name: "Alice", eventId: event.id } });

    await createEvent(postCtx(
      { id: event.id, historyId: history.id },
      { type: "goal", team: "one", scorerEventPlayerId: alice.id, count: 20 },
    ));
    const res = await listEvents(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].count).toBe(20);
    expect(body.score).toEqual({ teamOne: 20, teamTwo: 0 });
  });
});
