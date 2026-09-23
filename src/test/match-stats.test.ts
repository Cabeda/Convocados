import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));
vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn().mockResolvedValue(null),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { GET as getMatchStats } from "~/pages/api/events/[id]/match-stats";

function getCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", { method: "GET" });
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
  await prisma.event.deleteMany();
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
});
