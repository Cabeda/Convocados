import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { hashPassword } from "~/lib/eventAccess";
import { POST as bulkEnroll } from "~/pages/api/events/[id]/seasons/[seasonId]/memberships/bulk";

const mockGetSession = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: async () => false,
}));

function context(params: Record<string, string>, method: string, body?: unknown) {
  const request = new Request("http://localhost/api/events/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

async function seedEvent(password = false) {
  for (let index = 0; index < 8; index += 1) {
    const id = `bulk-user-${index}`;
    await prisma.user.create({ data: { id, name: `Player ${index}`, email: `${id}@example.test` } });
  }
  return prisma.event.create({
    data: {
      title: "Bulk Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "bulk-user-0",
      accessPassword: password ? hashPassword("secret") : null,
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedPlayers(eventId: string, count: number, withUser = true) {
  const players = [];
  for (let index = 0; index < count; index += 1) {
    players.push(await prisma.eventPlayer.create({
      data: { eventId, name: `Player ${index}`, userId: withUser ? `bulk-user-${index}` : null },
    }));
  }
  return players;
}

async function seedSeason(eventId: string, opensAt: Date, closesAt: Date) {
  return prisma.season.create({
    data: { eventId, name: "Bulk Season", registrationOpensAt: opensAt, registrationClosesAt: closesAt },
  });
}

async function seedGame(eventId: string, dateTime: Date, playerIds: string[]) {
  const game = await prisma.game.create({ data: { eventId, dateTime, status: "played" } });
  for (const eventPlayerId of playerIds) {
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId } });
  }
  return game;
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  await resetApiRateLimitStore();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.season.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST season memberships bulk enroll", () => {
  it("requires authentication", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000));

    const response = await bulkEnroll(context({ id: event.id, seasonId: season.id }, "POST", {}));

    expect(response.status).toBe(401);
  });

  it("requires event admin rights", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000));
    mockGetSession.mockResolvedValue({ user: { id: "bulk-user-1" } });

    const response = await bulkEnroll(context({ id: event.id, seasonId: season.id }, "POST", {}));

    expect(response.status).toBe(403);
  });

  it("enrolls players with games in the season period and reports the rest", async () => {
    const event = await seedEvent();
    const opensAt = new Date(Date.now() - 30 * 86400_000);
    const closesAt = new Date(Date.now() + 86400_000);
    const season = await seedSeason(event.id, opensAt, closesAt);
    const players = await seedPlayers(event.id, 5);
    // Players 0-1 played inside the window; player 2 played a year ago;
    // player 3 never played; player 4 has no account.
    await seedGame(event.id, new Date(Date.now() - 86400_000), [players[0].id, players[1].id, players[4].id]);
    await seedGame(event.id, new Date(Date.now() - 400 * 86400_000), [players[2].id]);
    await prisma.eventPlayer.update({ where: { id: players[4].id }, data: { userId: null } });
    mockGetSession.mockResolvedValue({ user: { id: "bulk-user-0" } });

    const response = await bulkEnroll(context({ id: event.id, seasonId: season.id }, "POST", {}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.added.map((entry: { name: string }) => entry.name).sort()).toEqual(["Player 0", "Player 1"]);
    expect(body.skipped.map((entry: { name: string }) => entry.name).sort()).toEqual(["Player 4"]);
    expect(body.skipped[0].reason).toBe("noAccount");
    expect(await prisma.seasonMembership.count({ where: { seasonId: season.id, status: "active" } })).toBe(2);
  });

  it("is idempotent and reactivates withdrawn members", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, new Date(Date.now() - 30 * 86400_000), new Date(Date.now() + 86400_000));
    const players = await seedPlayers(event.id, 2);
    await seedGame(event.id, new Date(Date.now() - 86400_000), [players[0].id, players[1].id]);
    await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: players[0].id, userId: "bulk-user-0", status: "withdrawn", withdrawnAt: new Date() },
    });
    mockGetSession.mockResolvedValue({ user: { id: "bulk-user-0" } });

    const first = await bulkEnroll(context({ id: event.id, seasonId: season.id }, "POST", {}));
    const firstBody = await first.json();
    expect(firstBody.added.map((entry: { name: string }) => entry.name).sort()).toEqual(["Player 0", "Player 1"]);

    const second = await bulkEnroll(context({ id: event.id, seasonId: season.id }, "POST", {}));
    const secondBody = await second.json();
    expect(secondBody.added).toEqual([]);
    expect(secondBody.skipped.map((entry: { name: string }) => entry.name).sort()).toEqual(["Player 0", "Player 1"]);
    expect(await prisma.seasonMembership.count({ where: { seasonId: season.id, status: "active" } })).toBe(2);
  });

  it("works after registration closed (admin override)", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, new Date(Date.now() - 60 * 86400_000), new Date(Date.now() - 30 * 86400_000));
    const players = await seedPlayers(event.id, 2);
    await seedGame(event.id, new Date(Date.now() - 45 * 86400_000), [players[0].id, players[1].id]);
    mockGetSession.mockResolvedValue({ user: { id: "bulk-user-0" } });

    const response = await bulkEnroll(context({ id: event.id, seasonId: season.id }, "POST", {}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.added).toHaveLength(2);
  });

  it("returns 404 for an unknown season", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "bulk-user-0" } });

    const response = await bulkEnroll(context({ id: event.id, seasonId: "missing" }, "POST", {}));

    expect(response.status).toBe(404);
  });
});
