import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server");
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";

import { PUT as reorderPlayers } from "~/pages/api/events/[id]/reorder-players";
import { POST as randomize } from "~/pages/api/events/[id]/randomize";
import { GET as _getStatus } from "~/pages/api/events/[id]/status";
import { GET as getUserStats } from "~/pages/api/users/[id]/stats";

function putCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

function postCtx(params: Record<string, string>, body: unknown, queryString?: string) {
  const urlStr = `http://localhost/api/test${queryString ? `?${queryString}` : ""}`;
  const request = new Request(urlStr, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params, url: new URL(urlStr) } as any;
}

function getCtx(params: Record<string, string>, queryString?: string) {
  const urlStr = `http://localhost/api/test${queryString ? `?${queryString}` : ""}`;
  const request = new Request(urlStr, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return { request, params, url: new URL(urlStr) } as any;
}

async function seedEvent(overrides: Record<string, any> = {}) {
  return prisma.event.create({
    data: {
      title: overrides.title ?? "Test Event",
      location: overrides.location ?? "Pitch A",
      dateTime: overrides.dateTime ?? new Date(Date.now() + 86400_000),
      teamOneName: overrides.teamOneName ?? "Team A",
      teamTwoName: overrides.teamTwoName ?? "Team B",
      ...overrides,
    },
  });
}

let userCounter = 0;
async function seedUser(name = "Test User") {
  userCounter++;
  return prisma.user.create({
    data: { id: `user-${userCounter}-${Date.now()}`, name, email: `${name.replace(/\s/g, "").toLowerCase()}-${userCounter}@test.com` },
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetApiRateLimitStore();
  await prisma.calendarToken.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── PUT /api/events/[id]/reorder-players ────────────────────────────────────

describe("PUT /api/events/[id]/reorder-players", () => {
  it("returns 404 for non-existent event", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
    const res = await reorderPlayers(putCtx({ id: "nonexistent" }, { playerIds: [] }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when not owner or admin", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const event = await seedEvent();
    const res = await reorderPlayers(putCtx({ id: event.id }, { playerIds: [] }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when playerIds is not an array", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
    const event = await seedEvent();
    const res = await reorderPlayers(putCtx({ id: event.id }, { playerIds: "not-array" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when playerIds don't match current players", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
    const event = await seedEvent();
    await prisma.player.create({ data: { name: "P1", eventId: event.id, order: 0 } });
    const res = await reorderPlayers(putCtx({ id: event.id }, { playerIds: ["wrong-id"] }));
    expect(res.status).toBe(400);
  });

  it("successfully reorders players", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
    const event = await seedEvent();
    const p1 = await prisma.player.create({ data: { name: "P1", eventId: event.id, order: 0 } });
    const p2 = await prisma.player.create({ data: { name: "P2", eventId: event.id, order: 1 } });
    const p3 = await prisma.player.create({ data: { name: "P3", eventId: event.id, order: 2 } });

    // Reverse order
    const res = await reorderPlayers(putCtx({ id: event.id }, { playerIds: [p3.id, p2.id, p1.id] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify new order
    const players = await prisma.player.findMany({ where: { eventId: event.id }, orderBy: { order: "asc" } });
    expect(players[0].name).toBe("P3");
    expect(players[1].name).toBe("P2");
    expect(players[2].name).toBe("P1");
  });

  it("allows admin to reorder players", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: true, session: null });
    const event = await seedEvent();
    const p1 = await prisma.player.create({ data: { name: "P1", eventId: event.id, order: 0 } });
    const p2 = await prisma.player.create({ data: { name: "P2", eventId: event.id, order: 1 } });

    const res = await reorderPlayers(putCtx({ id: event.id }, { playerIds: [p2.id, p1.id] }));
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/events/[id]/randomize (uncovered branches) ───────────────────

describe("POST /api/events/[id]/randomize — edge cases", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await randomize(postCtx({ id: "nonexistent" }, {}));
    expect(res.status).toBe(404);
  });

  it("returns 400 when fewer than 2 players", async () => {
    const event = await seedEvent();
    await prisma.player.create({ data: { name: "Solo", eventId: event.id, order: 0 } });
    const res = await randomize(postCtx({ id: event.id }, {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("at least 2");
  });

  it("randomizes only active players (not bench)", async () => {
    const event = await seedEvent();
    // Add maxPlayers + 2 players (2 on bench)
    for (let i = 0; i < event.maxPlayers + 2; i++) {
      await prisma.player.create({ data: { name: `P${i}`, eventId: event.id, order: i } });
    }
    const res = await randomize(postCtx({ id: event.id }, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify teams only contain active players
    const teams = await prisma.teamResult.findMany({
      where: { eventId: event.id },
      include: { members: true },
    });
    const allTeamMembers = teams.flatMap((t) => t.members.map((m) => m.name));
    expect(allTeamMembers).not.toContain(`P${event.maxPlayers}`);
    expect(allTeamMembers).not.toContain(`P${event.maxPlayers + 1}`);
  });

  it("balanced randomization uses ELO ratings", async () => {
    const event = await seedEvent();
    for (let i = 0; i < 4; i++) {
      await prisma.player.create({ data: { name: `P${i}`, eventId: event.id, order: i } });
      await prisma.playerRating.create({
        data: { eventId: event.id, name: `P${i}`, rating: 1000 + i * 100 },
      });
    }
    const res = await randomize(postCtx({ id: event.id }, {}, "balanced=true"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.balanced).toBe(true);
  });
});

// ─── GET /api/users/[id]/stats — uncovered branches ─────────────────────────

describe("GET /api/users/[id]/stats", () => {
  it("returns 404 for non-existent user", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await getUserStats(getCtx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when stats are private and viewer is not the user", async () => {
    const user = await seedUser("Private User");
    await prisma.user.update({ where: { id: user.id }, data: { publicStats: false, profileVisibility: "private" } });
    vi.mocked(getSession).mockResolvedValue({ user: { id: "other-user" } } as any);
    const res = await getUserStats(getCtx({ id: user.id }));
    expect(res.status).toBe(403);
  });

  it("allows user to view their own private stats", async () => {
    const user = await seedUser("Self User");
    await prisma.user.update({ where: { id: user.id }, data: { publicStats: false, profileVisibility: "private" } });
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id } } as any);
    const res = await getUserStats(getCtx({ id: user.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(user.id);
    expect(body.summary.totalGames).toBe(0);
  });

  it("returns stats with ratings from multiple events", async () => {
    const user = await seedUser("Multi Event");
    vi.mocked(getSession).mockResolvedValue(null);
    const event1 = await seedEvent({ title: "Event 1" });
    const event2 = await seedEvent({ title: "Event 2" });

    await prisma.playerRating.create({
      data: { eventId: event1.id, name: user.name, userId: user.id, rating: 1200, gamesPlayed: 5, wins: 3, draws: 1, losses: 1 },
    });
    await prisma.playerRating.create({
      data: { eventId: event2.id, name: user.name, userId: user.id, rating: 1100, gamesPlayed: 3, wins: 1, draws: 1, losses: 1 },
    });

    const res = await getUserStats(getCtx({ id: user.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGames).toBe(8);
    expect(body.summary.totalWins).toBe(4);
    expect(body.summary.eventsPlayed).toBe(2);
    expect(body.events).toHaveLength(2);
  });

  it("finds ratings by name match when userId not set on rating", async () => {
    const user = await seedUser("Name Match");
    vi.mocked(getSession).mockResolvedValue(null);
    const event = await seedEvent();

    // Player linked to user but rating has no userId
    await prisma.player.create({
      data: { name: user.name, eventId: event.id, order: 0, userId: user.id },
    });
    await prisma.playerRating.create({
      data: { eventId: event.id, name: user.name, rating: 1050, gamesPlayed: 2, wins: 1, draws: 0, losses: 1 },
    });

    const res = await getUserStats(getCtx({ id: user.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGames).toBe(2);
    expect(body.events).toHaveLength(1);
  });

  it("deduplicates ratings preferring userId-linked ones", async () => {
    const user = await seedUser("Dedup User");
    vi.mocked(getSession).mockResolvedValue(null);
    const event = await seedEvent();

    // Player linked to user
    await prisma.player.create({
      data: { name: user.name, eventId: event.id, order: 0, userId: user.id },
    });
    // Rating with userId
    await prisma.playerRating.create({
      data: { eventId: event.id, name: user.name, userId: user.id, rating: 1200, gamesPlayed: 5, wins: 3, draws: 1, losses: 1 },
    });

    const res = await getUserStats(getCtx({ id: user.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should not duplicate
    expect(body.events).toHaveLength(1);
    expect(body.summary.totalGames).toBe(5);
  });

  it("includes attendance data from game history", async () => {
    const user = await seedUser("Attendance User");
    vi.mocked(getSession).mockResolvedValue(null);
    const event = await seedEvent();

    await prisma.playerRating.create({
      data: { eventId: event.id, name: user.name, userId: user.id, rating: 1000, gamesPlayed: 2, wins: 1, draws: 0, losses: 1 },
    });

    // Create game history with teams snapshot including the user
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(Date.now() - 86400_000),
        teamOneName: "Team A",
        teamTwoName: "Team B",
        status: "played",
        editableUntil: new Date(Date.now() + 86400_000 * 7),
        teamsSnapshot: JSON.stringify([
          { team: "Team A", players: [{ name: user.name, order: 0 }] },
          { team: "Team B", players: [{ name: "Other", order: 0 }] },
        ]),
      },
    });

    const res = await getUserStats(getCtx({ id: user.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events[0].attendance).toBeTruthy();
  });
});
