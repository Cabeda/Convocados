import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

import { getSession } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);

import { GET } from "~/pages/api/events/[id]/history/[historyId]";

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
        { team: "Gunas", players: [{ name: "Cara", order: 0 }, { name: "Dan", order: 1 }] },
      ]),
      ...overrides,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  await resetApiRateLimitStore();
  await prisma.matchEvent.deleteMany();
  await prisma.mvpVote.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

describe("GET single history entry", () => {
  it("returns eloProcessed so the card can render the right ELO state", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id, { source: "historical", eloProcessed: true });

    const res = await GET(getCtx({ id: event.id, historyId: history.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eloProcessed).toBe(true);
    expect(body.source).toBe("historical");
  });

  it("returns eloProcessed=false when not yet approved", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id, { source: "historical", eloProcessed: false });

    const res = await GET(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.eloProcessed).toBe(false);
  });

  it("returns the game's match events so the game page can render the timeline", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice", minute: 12 },
    });
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "two", scorerName: "Cara", assistName: "Dan" },
    });

    const res = await GET(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.matchEvents).toHaveLength(2);
    const alice = body.matchEvents.find((e: { scorerName: string }) => e.scorerName === "Alice");
    const cara = body.matchEvents.find((e: { scorerName: string }) => e.scorerName === "Cara");
    expect(alice.minute).toBe(12);
    expect(cara.assistName).toBe("Dan");
  });

  it("omits match events for set-based sports", async () => {
    const event = await seedEvent({ sport: "padel" });
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({
      data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice" },
    });

    const res = await GET(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.matchEvents).toEqual([]);
  });

  it("returns isFriendly so the card can render the friendly toggle", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id, { isFriendly: true });

    const res = await GET(getCtx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.isFriendly).toBe(true);
  });
});
