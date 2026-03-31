import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
const mockCheckOwnership = vi.mocked(checkOwnership);
const mockGetSession = vi.mocked(getSession);

import { POST } from "~/pages/api/events/[id]/history/index";
import { POST as POST_APPROVE } from "~/pages/api/events/[id]/history/[historyId]/approve-elo";

function ctx(params: Record<string, string>, body?: unknown, method = "POST") {
  const request = new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedUser(id: string, name: string) {
  await prisma.user.upsert({
    where: { id },
    create: { id, name, email: `${id}@test.com`, emailVerified: true },
    update: {},
  });
}

async function seedEvent(ownerId?: string) {
  if (ownerId) {
    await seedUser(ownerId, "Owner");
  }
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: ownerId ?? null,
      eloEnabled: true,
    },
  });
}

describe("Historical Game Creation API", () => {
  beforeEach(async () => {
    await prisma.playerRating.deleteMany();
    await prisma.gameHistory.deleteMany();
    await prisma.eventAdmin.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
    mockGetSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as any);
    mockCheckOwnership.mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1", name: "Owner" } },
    } as any);
  });

  it("creates a historical game with source=historical", async () => {
    const event = await seedEvent("owner1");

    const body = {
      dateTime: "2024-01-15T10:00:00Z",
      teamOneName: "Team A",
      teamTwoName: "Team B",
      scoreOne: 3,
      scoreTwo: 1,
      teamsSnapshot: [
        { team: "Team A", players: [{ name: "Player1", order: 0 }, { name: "Player2", order: 1 }] },
        { team: "Team B", players: [{ name: "Player3", order: 0 }, { name: "Player4", order: 1 }] },
      ],
    };

    const res = await POST(ctx({ id: event.id }, body));
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.source).toBe("historical");
    expect(data.eloProcessed).toBe(false);
    expect(data.scoreOne).toBe(3);
    expect(data.scoreTwo).toBe(1);
    expect(data.teamOneName).toBe("Team A");
    expect(data.teamTwoName).toBe("Team B");
  });

  it("does NOT automatically process ELO for historical games", async () => {
    const event = await seedEvent("owner1");

    const body = {
      dateTime: "2024-01-15T10:00:00Z",
      teamOneName: "Team A",
      teamTwoName: "Team B",
      scoreOne: 3,
      scoreTwo: 1,
      teamsSnapshot: [
        { team: "Team A", players: [{ name: "Player1", order: 0 }] },
        { team: "Team B", players: [{ name: "Player2", order: 0 }] },
      ],
    };

    const res = await POST(ctx({ id: event.id }, body));
    expect(res.status).toBe(201);

    // Verify ELO was NOT processed
    const ratings = await prisma.playerRating.findMany({ where: { eventId: event.id } });
    expect(ratings).toHaveLength(0); // No ratings created yet
  });

  it("returns 403 for non-owner", async () => {
    const event = await seedEvent("owner1");
    mockCheckOwnership.mockResolvedValue({
      isOwner: false,
      isAdmin: false,
      session: { user: { id: "other", name: "Other" } },
    } as any);

    const body = {
      dateTime: "2024-01-15T10:00:00Z",
      teamOneName: "Team A",
      teamTwoName: "Team B",
      scoreOne: 3,
      scoreTwo: 1,
      teamsSnapshot: [
        { team: "Team A", players: [{ name: "Player1", order: 0 }] },
        { team: "Team B", players: [{ name: "Player2", order: 0 }] },
      ],
    };

    const res = await POST(ctx({ id: event.id }, body));
    expect(res.status).toBe(403);
  });

  it("allows admin to create historical games", async () => {
    const event = await seedEvent("owner1");
    mockCheckOwnership.mockResolvedValue({
      isOwner: false,
      isAdmin: true,
      session: { user: { id: "admin1", name: "Admin" } },
    } as any);

    const body = {
      dateTime: "2024-01-15T10:00:00Z",
      teamOneName: "Team A",
      teamTwoName: "Team B",
      scoreOne: 3,
      scoreTwo: 1,
      teamsSnapshot: [
        { team: "Team A", players: [{ name: "Player1", order: 0 }] },
        { team: "Team B", players: [{ name: "Player2", order: 0 }] },
      ],
    };

    const res = await POST(ctx({ id: event.id }, body));
    expect(res.status).toBe(201);
  });

  it("returns 400 for invalid body", async () => {
    const event = await seedEvent("owner1");

    const res = await POST(ctx({ id: event.id }, { teamOneName: "Team A" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await POST(ctx({ id: "nonexistent" }, { teamOneName: "Team A" }));
    expect(res.status).toBe(404);
  });
});

describe("Approve ELO for Historical Game API", () => {
  beforeEach(async () => {
    await prisma.playerRating.deleteMany();
    await prisma.gameHistory.deleteMany();
    await prisma.eventAdmin.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
    mockGetSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as any);
    mockCheckOwnership.mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1", name: "Owner" } },
    } as any);
  });

  it("processes ELO when approved", async () => {
    const event = await seedEvent("owner1");

    // Create a historical game
    const game = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2024-01-15T10:00:00Z"),
        teamOneName: "Team A",
        teamTwoName: "Team B",
        scoreOne: 3,
        scoreTwo: 1,
        teamsSnapshot: JSON.stringify([
          { team: "Team A", players: [{ name: "Player1", order: 0 }, { name: "Player2", order: 1 }] },
          { team: "Team B", players: [{ name: "Player3", order: 0 }, { name: "Player4", order: 1 }] },
        ]),
        source: "historical",
        eloProcessed: false,
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await POST_APPROVE(ctx({ id: event.id, historyId: game.id }, {}));
    expect(res.status).toBe(200);

    // Verify ELO was processed
    const updated = await prisma.gameHistory.findUnique({ where: { id: game.id } });
    expect(updated!.eloProcessed).toBe(true);

    // Verify ratings were created
    const ratings = await prisma.playerRating.findMany({ where: { eventId: event.id } });
    expect(ratings).toHaveLength(4);
    expect(ratings.some((r) => r.name === "Player1")).toBe(true);
  });

  it("returns 404 for non-existent game", async () => {
    const event = await seedEvent("owner1");

    const res = await POST_APPROVE(ctx({ id: event.id, historyId: "nonexistent" }, {}));
    expect(res.status).toBe(404);
  });

  it("returns 400 for already processed game", async () => {
    const event = await seedEvent("owner1");

    // Create an already processed game
    const game = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2024-01-15T10:00:00Z"),
        teamOneName: "Team A",
        teamTwoName: "Team B",
        scoreOne: 3,
        scoreTwo: 1,
        teamsSnapshot: JSON.stringify([
          { team: "Team A", players: [{ name: "Player1", order: 0 }] },
          { team: "Team B", players: [{ name: "Player2", order: 0 }] },
        ]),
        source: "historical",
        eloProcessed: true, // Already processed
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await POST_APPROVE(ctx({ id: event.id, historyId: game.id }, {}));
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-owner", async () => {
    const event = await seedEvent("owner1");
    mockCheckOwnership.mockResolvedValue({
      isOwner: false,
      isAdmin: false,
      session: { user: { id: "other", name: "Other" } },
    } as any);

    const game = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2024-01-15T10:00:00Z"),
        teamOneName: "Team A",
        teamTwoName: "Team B",
        scoreOne: 3,
        scoreTwo: 1,
        teamsSnapshot: JSON.stringify([
          { team: "Team A", players: [{ name: "Player1", order: 0 }] },
          { team: "Team B", players: [{ name: "Player2", order: 0 }] },
        ]),
        source: "historical",
        eloProcessed: false,
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await POST_APPROVE(ctx({ id: event.id, historyId: game.id }, {}));
    expect(res.status).toBe(403);
  });
});
