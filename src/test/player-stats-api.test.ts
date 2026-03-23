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

import { GET as getStats } from "~/pages/api/me/stats";

function ctx(queryString?: string) {
  const urlStr = `http://localhost/api/me/stats${queryString ? `?${queryString}` : ""}`;
  const request = new Request(urlStr, { method: "GET" });
  return { request, params: {}, url: new URL(urlStr) } as any;
}

async function seedUser(id: string, name: string, email: string) {
  await prisma.user.upsert({
    where: { id },
    create: { id, name, email, emailVerified: true },
    update: {},
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

async function seedGameHistory(eventId: string, dateTime: Date, players: string[][], status = "played") {
  const teamsSnapshot = JSON.stringify(players.map((team, i) => ({
    team: `Team ${i + 1}`,
    players: team.map((name, j) => ({ name, order: j })),
  })));

  await prisma.gameHistory.create({
    data: {
      eventId,
      dateTime,
      teamOneName: "Team 1",
      teamTwoName: "Team 2",
      teamsSnapshot,
      status,
      editableUntil: new Date(dateTime.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("GET /api/me/stats", () => {
  it("returns 401 for unauthenticated users", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await getStats(ctx());
    expect(res.status).toBe(401);
  });

  it("returns empty stats for user with no games", async () => {
    await seedUser("user1", "Test User", "test@test.com");
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User" },
      session: {},
    } as any);

    const res = await getStats(ctx());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary.totalGames).toBe(0);
    expect(body.summary.totalWins).toBe(0);
    expect(body.events).toHaveLength(0);
  });

  it("aggregates stats across multiple events", async () => {
    await seedUser("user1", "Test User", "test@test.com");

    await seedEventWithRatings(null, "Event A", "user1", "Test User", {
      rating: 1100, gamesPlayed: 10, wins: 6, draws: 2, losses: 2,
    });
    await seedEventWithRatings(null, "Event B", "user1", "Test User", {
      rating: 950, gamesPlayed: 5, wins: 2, draws: 1, losses: 2,
    });

    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User" },
      session: {},
    } as any);

    const res = await getStats(ctx());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary.totalGames).toBe(15);
    expect(body.summary.totalWins).toBe(8);
    expect(body.summary.totalDraws).toBe(3);
    expect(body.summary.totalLosses).toBe(4);
    expect(body.summary.avgRating).toBeCloseTo(1025, 0);
    expect(body.events).toHaveLength(2);
  });

  it("includes per-event breakdown with event title", async () => {
    await seedUser("user1", "Test User", "test@test.com");

    const event = await seedEventWithRatings(null, "Friday Footy", "user1", "Test User", {
      rating: 1200, gamesPlayed: 8, wins: 5, draws: 1, losses: 2,
    });

    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User" },
      session: {},
    } as any);

    const res = await getStats(ctx());
    const body = await res.json();

    expect(body.events[0].eventTitle).toBe("Friday Footy");
    expect(body.events[0].rating).toBe(1200);
    expect(body.events[0].gamesPlayed).toBe(8);
    expect(body.events[0].wins).toBe(5);
  });

  it("calculates win rate correctly", async () => {
    await seedUser("user1", "Test User", "test@test.com");

    await seedEventWithRatings(null, "Event A", "user1", "Test User", {
      rating: 1000, gamesPlayed: 10, wins: 7, draws: 1, losses: 2,
    });

    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User" },
      session: {},
    } as any);

    const res = await getStats(ctx());
    const body = await res.json();

    expect(body.summary.winRate).toBeCloseTo(0.7, 2);
  });

  it("includes attendance data from game history", async () => {
    await seedUser("user1", "Test User", "test@test.com");

    const event = await seedEventWithRatings(null, "Weekly Game", "user1", "Test User", {
      rating: 1000, gamesPlayed: 3, wins: 1, draws: 1, losses: 1,
    });

    // Link user to event as player
    await prisma.player.create({
      data: { eventId: event.id, name: "Test User", userId: "user1" },
    });

    // Create game history with the user in teams
    const now = Date.now();
    await seedGameHistory(event.id, new Date(now - 3 * 86400_000), [["Test User", "Alice"], ["Bob", "Carol"]]);
    await seedGameHistory(event.id, new Date(now - 2 * 86400_000), [["Test User", "Bob"], ["Alice", "Carol"]]);
    await seedGameHistory(event.id, new Date(now - 1 * 86400_000), [["Alice", "Bob"], ["Carol", "Dave"]]);

    mockGetSession.mockResolvedValueOnce({
      user: { id: "user1", name: "Test User" },
      session: {},
    } as any);

    const res = await getStats(ctx());
    const body = await res.json();

    // User played 2 out of 3 games
    expect(body.events[0].attendance).toBeDefined();
    expect(body.events[0].attendance.gamesPlayed).toBe(2);
    expect(body.events[0].attendance.totalGames).toBe(3);
  });
});
