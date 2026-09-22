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

import { DELETE } from "~/pages/api/events/[id]/history/[historyId]/match-events/[matchEventId]";
import { GET as listEvents } from "~/pages/api/events/[id]/history/[historyId]/match-events";

function ctx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", { method: "DELETE" });
  return { request, params } as any;
}

async function seedUser(name = "Test User") {
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({ data: { id, name, email: `${id}@test.com`, emailVerified: false } });
}

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Event", location: "Pitch A", dateTime: new Date(Date.now() - 3600_000),
      durationMinutes: 30, teamOneName: "Ninjas", teamTwoName: "Gunas", sport: "football-5v5", ...overrides,
    },
  });
}

async function seedHistory(eventId: string) {
  return prisma.gameHistory.create({
    data: {
      eventId, dateTime: new Date(Date.now() - 3600_000), status: "played",
      teamOneName: "Ninjas", teamTwoName: "Gunas",
      teamsSnapshot: JSON.stringify([
        { team: "Ninjas", players: [{ name: "Alice", order: 0 }] },
        { team: "Gunas", players: [{ name: "Cara", order: 0 }] },
      ]),
    },
  });
}

function mockAuth(userId: string, userName: string) {
  mockGetSession.mockResolvedValue({ user: { id: userId, name: userName, email: `${userId}@test.com` } } as any);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.matchEvent.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("DELETE match event", () => {
  it("requires authentication", async () => {
    const event = await seedEvent();
    const history = await seedHistory(event.id);
    const goal = await prisma.matchEvent.create({ data: { gameHistoryId: history.id, scorerName: "Alice" } });

    const res = await DELETE(ctx({ id: event.id, historyId: history.id, matchEventId: goal.id }));
    expect(res.status).toBe(401);
  });

  it("lets the owner remove a goal and re-derives the score", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({ data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice" } });
    const second = await prisma.matchEvent.create({ data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice" } });
    await prisma.gameHistory.update({ where: { id: history.id }, data: { scoreOne: 2, scoreTwo: 0 } });

    const res = await DELETE(ctx({ id: event.id, historyId: history.id, matchEventId: second.id }));
    expect(res.status).toBe(200);

    const stored = await prisma.matchEvent.findMany({ where: { gameHistoryId: history.id } });
    expect(stored).toHaveLength(1);

    const updated = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(updated?.scoreOne).toBe(1);
    expect(updated?.scoreTwo).toBe(0);
  });

  it("restores the manual score when the last goal is removed", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    const goal = await prisma.matchEvent.create({ data: { gameHistoryId: history.id, type: "goal", team: "two", scorerName: "Cara" } });
    await prisma.gameHistory.update({ where: { id: history.id }, data: { scoreOne: 3, scoreTwo: 1 } });

    await DELETE(ctx({ id: event.id, historyId: history.id, matchEventId: goal.id }));

    // No goals left, so the manually entered score stands.
    const updated = await prisma.gameHistory.findUnique({ where: { id: history.id } });
    expect(updated?.scoreOne).toBe(3);
    expect(updated?.scoreTwo).toBe(1);
  });

  it("rejects a non-participant", async () => {
    const stranger = await seedUser("Stranger");
    mockAuth(stranger.id, "Stranger");
    const owner = await seedUser("Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    const goal = await prisma.matchEvent.create({ data: { gameHistoryId: history.id, scorerName: "Alice" } });

    const res = await DELETE(ctx({ id: event.id, historyId: history.id, matchEventId: goal.id }));
    expect(res.status).toBe(403);
  });

  it("404s for a goal from another game", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    const other = await seedHistory(event.id);
    const goal = await prisma.matchEvent.create({ data: { gameHistoryId: other.id, scorerName: "Alice" } });

    const res = await DELETE(ctx({ id: event.id, historyId: history.id, matchEventId: goal.id }));
    expect(res.status).toBe(404);
    expect(await prisma.matchEvent.count()).toBe(1);
  });

  it("keeps the timeline consistent after removal", async () => {
    const owner = await seedUser("Owner");
    mockAuth(owner.id, "Owner");
    const event = await seedEvent({ ownerId: owner.id });
    const history = await seedHistory(event.id);
    await prisma.matchEvent.create({ data: { gameHistoryId: history.id, type: "goal", team: "one", scorerName: "Alice", minute: 5 } });
    const drop = await prisma.matchEvent.create({ data: { gameHistoryId: history.id, type: "goal", team: "two", scorerName: "Cara", minute: 9 } });

    await DELETE(ctx({ id: event.id, historyId: history.id, matchEventId: drop.id }));

    const res = await listEvents(ctx({ id: event.id, historyId: history.id }));
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].scorerName).toBe("Alice");
    expect(body.score).toEqual({ teamOne: 1, teamTwo: 0 });
  });
});
