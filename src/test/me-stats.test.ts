import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/me/stats";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/auth.helpers.server")>("~/lib/auth.helpers.server");
  return {
    ...actual,
    getSession: vi.fn(),
  };
});

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
}));

beforeEach(async () => {
  await prisma.mvpVote.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.player.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(userId?: string) {
  return {
    request: new Request("http://localhost/api/me/stats", {
      headers: userId ? { authorization: `Bearer test-token` } : {},
    }),
    url: new URL("http://localhost/api/me/stats"),
  } as any;
}

async function seedUser(id = "user-stats-1") {
  return prisma.user.create({
    data: { id, name: "Stats User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(id: string, title: string) {
  return prisma.event.create({
    data: { id, title, location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
  });
}

describe("GET /api/me/stats", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null);
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await GET(ctx());
    expect(res.status).toBe(401);
  });

  it("returns empty stats for new user", async () => {
    const user = await seedUser();
    vi.mocked(authenticateRequest).mockResolvedValue(null);
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, name: user.name } } as any);

    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGames).toBe(0);
    expect(body.events).toEqual([]);
  });

  it("returns stats with ratings", async () => {
    const user = await seedUser();
    const event = await seedEvent("evt-stats-1", "Game 1");
    await prisma.playerRating.create({
      data: {
        eventId: event.id,
        userId: user.id,
        name: user.name,
        rating: 1500,
        gamesPlayed: 5,
        wins: 3,
        draws: 1,
        losses: 1,
      },
    });

    vi.mocked(authenticateRequest).mockResolvedValue(null);
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, name: user.name } } as any);

    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGames).toBe(5);
    expect(body.summary.totalWins).toBe(3);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].rating).toBe(1500);
  });

  it("handles OAuth bearer token authentication", async () => {
    const user = await seedUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, client: {} as any });
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await GET(ctx(user.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.eventsPlayed).toBe(0);
  });

  it("deduplicates ratings by eventId preferring userId match", async () => {
    const user = await seedUser();
    const event = await seedEvent("evt-stats-2", "Game 2");
    await prisma.playerRating.create({
      data: {
        eventId: event.id,
        name: "Old Name",
        rating: 1400,
        gamesPlayed: 3,
        wins: 1,
        draws: 1,
        losses: 1,
      },
    });
    await prisma.playerRating.create({
      data: {
        eventId: event.id,
        userId: user.id,
        name: user.name,
        rating: 1600,
        gamesPlayed: 5,
        wins: 4,
        draws: 0,
        losses: 1,
      },
    });

    vi.mocked(authenticateRequest).mockResolvedValue(null);
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, name: user.name } } as any);

    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGames).toBe(5);
    expect(body.summary.totalWins).toBe(4);
  });

  it("includes MVP awards", async () => {
    const user = await seedUser();
    const event = await seedEvent("evt-stats-3", "Game 3");
    await prisma.playerRating.create({
      data: {
        eventId: event.id,
        userId: user.id,
        name: user.name,
        rating: 1500,
        gamesPlayed: 1,
        wins: 1,
        draws: 0,
        losses: 0,
      },
    });
    const history = await prisma.gameHistory.create({
      data: { eventId: event.id, dateTime: new Date(), teamOneName: "A", teamTwoName: "B", editableUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    await prisma.mvpVote.create({
      data: {
        gameHistoryId: history.id,
        voterPlayerId: "voter-1",
        voterName: "Voter",
        votedForPlayerId: "player-1",
        votedForName: user.name,
      },
    });

    vi.mocked(authenticateRequest).mockResolvedValue(null);
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, name: user.name } } as any);

    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalMvpAwards).toBe(1);
    expect(body.events[0].mvpAwards).toBe(1);
  });

  it("fetches user name from db when session has no name", async () => {
    const user = await seedUser();
    vi.mocked(authenticateRequest).mockResolvedValue(null);
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, name: null } } as any);

    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGames).toBe(0);
  });
});
