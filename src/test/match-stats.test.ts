import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/auth.helpers.server")>();
  return {
    ...actual,
    getSession: vi.fn(),
  };
});
vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn().mockResolvedValue(null),
}));

import { getSession } from "~/lib/auth.helpers.server";
import { buildAccessCookie, hashPassword } from "~/lib/eventAccess";
const mockGetSession = vi.mocked(getSession);

import { GET as getMatchStats } from "~/pages/api/events/[id]/match-stats";

function getCtx(params: Record<string, string>, cookie?: string) {
  const request = new Request("http://localhost/api/test", {
    method: "GET",
    headers: cookie ? { cookie } : undefined,
  });
  return { request, params } as any;
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() - 3600_000),
      durationMinutes: 30,
      sport: "football-5v5",
      ...overrides,
    },
  });
}

async function seedUser(prefix: string) {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await prisma.user.create({
    data: { id, name: prefix, email: `${id}@test.com`, emailVerified: false },
  });
  return id;
}

async function seedHistory(eventId: string) {
  return prisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(Date.now() - 3600_000),
      status: "played",
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.matchEvent.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.eventInvite.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("GET event match-stats", () => {
  it("returns an empty table when nothing is logged", async () => {
    const event = await seedEvent();
    const res = await getMatchStats(getCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scorers).toEqual([]);
  });

  it("aggregates goals and assists per player", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);
    const alice = await prisma.eventPlayer.create({ data: { name: "Alice", eventId: event.id } });
    const bob = await prisma.eventPlayer.create({ data: { name: "Bob", eventId: event.id } });

    await prisma.matchEvent.createMany({
      data: [
        { gameHistoryId: history.id, type: "goal", team: "one", scorerEventPlayerId: alice.id, scorerName: "Alice", assistEventPlayerId: bob.id, assistName: "Bob" },
        { gameHistoryId: history.id, type: "goal", team: "one", scorerEventPlayerId: alice.id, scorerName: "Alice" },
        { gameHistoryId: history.id, type: "goal", team: "two", scorerEventPlayerId: bob.id, scorerName: "Bob" },
      ],
    });

    const res = await getMatchStats(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.scorers).toHaveLength(2);
    expect(body.scorers[0]).toMatchObject({ name: "Alice", goals: 2, assists: 0 });
    expect(body.scorers[1]).toMatchObject({ name: "Bob", goals: 1, assists: 1 });
  });

  it("counts own goals against the scorer and excludes assists from the tally", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);

    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice", ownGoal: true },
    });

    const res = await getMatchStats(getCtx({ id: event.id }));
    const body = await res.json();
    const alice = body.scorers.find((s: { name: string }) => s.name === "Alice");
    expect(alice.goals).toBe(1);
    expect(alice.ownGoals).toBe(1);
  });

  it("hides the table from a non-owner when showCompetitiveData is false", async () => {
    const ownerId = await seedUser("owner");
    const viewerId = await seedUser("viewer");
    const event = await seedEvent({ ownerId, showCompetitiveData: false });
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice" },
    });
    mockGetSession.mockResolvedValue({ user: { id: viewerId } } as any);

    const res = await getMatchStats(getCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scorers).toEqual([]);
  });

  it("keeps the table visible to the owner on a hidden-competitive event", async () => {
    const ownerId = await seedUser("owner");
    const event = await seedEvent({ ownerId, showCompetitiveData: false });
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice" },
    });
    mockGetSession.mockResolvedValue({ user: { id: ownerId } } as any);

    const res = await getMatchStats(getCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scorers).toHaveLength(1);
  });

  it("keeps the table visible to an event admin on a hidden-competitive event", async () => {
    const ownerId = await seedUser("owner");
    const adminId = await seedUser("admin");
    const event = await seedEvent({ ownerId, showCompetitiveData: false });
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: adminId } });
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice" },
    });
    mockGetSession.mockResolvedValue({ user: { id: adminId } } as any);

    const res = await getMatchStats(getCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scorers).toHaveLength(1);
  });

  it("requires the event password before returning the table", async () => {
    const ownerId = await seedUser("owner");
    const event = await seedEvent({ ownerId, accessPassword: hashPassword("secret") });
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice" },
    });

    const locked = await getMatchStats(getCtx({ id: event.id }));
    expect(locked.status).toBe(403);

    const cookie = buildAccessCookie(null, event.id, event.accessPassword!);
    const unlocked = await getMatchStats(getCtx({ id: event.id }, cookie));
    expect(unlocked.status).toBe(200);
    const body = await unlocked.json();
    expect(body.scorers).toHaveLength(1);
  });
});
