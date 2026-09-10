import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as listCandidates } from "~/pages/api/events/[id]/seasons/[seasonId]/memberships/candidates";
import { POST as enrollMember } from "~/pages/api/events/[id]/seasons/[seasonId]/memberships/index";

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

async function seedEvent() {
  for (let index = 0; index < 4; index += 1) {
    const id = `cand-user-${index}`;
    await prisma.user.create({ data: { id, name: `Player ${index}`, email: `${id}@example.test` } });
  }
  return prisma.event.create({
    data: {
      title: "Candidate Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "cand-user-0",
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedSeason(eventId: string) {
  return prisma.season.create({
    data: {
      eventId,
      name: "Candidate Season",
      registrationOpensAt: new Date(Date.now() - 30 * 86400_000),
      registrationClosesAt: new Date(Date.now() + 86400_000),
    },
  });
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

describe("GET season membership candidates", () => {
  it("requires admin rights", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "cand-user-1" } });

    const response = await listCandidates(context({ id: event.id, seasonId: season.id }, "GET"));

    expect(response.status).toBe(403);
  });

  it("lists event players with account, attendance and membership state", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const players = [];
    for (let index = 0; index < 3; index += 1) {
      players.push(await prisma.eventPlayer.create({
        data: { eventId: event.id, name: `Player ${index}`, userId: `cand-user-${index}` },
      }));
    }
    const guest = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Guest" } });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - 86400_000), status: "played" } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: players[0].id } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: players[1].id, userId: "cand-user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "cand-user-0" } });

    const response = await listCandidates(context({ id: event.id, seasonId: season.id }, "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.players).toHaveLength(4);
    expect(body.players.find((p: { name: string }) => p.name === "Player 0")).toMatchObject({
      hasAccount: true, gamesPlayed: 1, memberStatus: null,
    });
    expect(body.players.find((p: { name: string }) => p.name === "Player 1")).toMatchObject({
      memberStatus: "active",
    });
    expect(body.players.find((p: { name: string }) => p.name === "Guest")).toMatchObject({
      hasAccount: false, memberStatus: null,
    });
    expect(guest).toBeTruthy();
  });
});

describe("POST season membership single enroll", () => {
  it("requires admin rights", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "cand-user-1" } });

    const response = await enrollMember(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: "x" }));

    expect(response.status).toBe(403);
  });

  it("enrolls an account-linked player into a Crew", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 1", userId: "cand-user-1" } });
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "North", sortOrder: 0 } });
    mockGetSession.mockResolvedValue({ user: { id: "cand-user-0" } });

    const response = await enrollMember(
      context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id, crewId: crew.id }),
      );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.membership).toMatchObject({ eventPlayerId: player.id, userId: "cand-user-1", crewId: crew.id, status: "active" });
  });

  it("rejects players without an account", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const guest = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Guest" } });
    mockGetSession.mockResolvedValue({ user: { id: "cand-user-0" } });

    const response = await enrollMember(
      context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: guest.id }),
    );

    expect(response.status).toBe(422);
  });

  it("rejects unknown players and foreign crews", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const otherSeason = await prisma.season.create({
      data: {
        eventId: event.id,
        name: "Old Season",
        status: "completed",
        registrationOpensAt: new Date(Date.now() - 90 * 86400_000),
        registrationClosesAt: new Date(Date.now() - 60 * 86400_000),
      },
    });
    const foreignCrew = await prisma.crew.create({ data: { seasonId: otherSeason.id, name: "Foreign", sortOrder: 0 } });
    mockGetSession.mockResolvedValue({ user: { id: "cand-user-0" } });

    const missingPlayer = await enrollMember(
      context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: "missing" }),
    );
    expect(missingPlayer.status).toBe(404);

    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 1", userId: "cand-user-1" } });
    const foreign = await enrollMember(
      context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id, crewId: foreignCrew.id }),
    );
    expect(foreign.status).toBe(404);
  });

  it("reactivates withdrawn members and rejects duplicates", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 1", userId: "cand-user-1" } });
    await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: player.id, userId: "cand-user-1", status: "withdrawn", withdrawnAt: new Date() },
    });
    mockGetSession.mockResolvedValue({ user: { id: "cand-user-0" } });

    const reactivated = await enrollMember(
      context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }),
    );
    expect(reactivated.status).toBe(200);

    const duplicate = await enrollMember(
      context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }),
    );
    expect(duplicate.status).toBe(409);
  });
});
