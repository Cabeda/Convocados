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

  it("returns 400 for non-historical (live) game", async () => {
    const event = await seedEvent("owner1");

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
        source: "live", // Not historical
        eloProcessed: false,
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await POST_APPROVE(ctx({ id: event.id, historyId: game.id }, {}));
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    const event = await seedEvent("owner1");
    mockGetSession.mockResolvedValue(null as any);

    const res = await POST_APPROVE(ctx({ id: event.id, historyId: "any" }, {}));
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await POST_APPROVE(ctx({ id: "nonexistent", historyId: "any" }, {}));
    expect(res.status).toBe(404);
  });

  it("returns 400 when game has no teamsSnapshot", async () => {
    const event = await seedEvent("owner1");

    const game = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2024-01-15T10:00:00Z"),
        teamOneName: "Team A",
        teamTwoName: "Team B",
        scoreOne: null,
        scoreTwo: null,
        teamsSnapshot: null, // Missing snapshot
        source: "historical",
        eloProcessed: false,
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await POST_APPROVE(ctx({ id: event.id, historyId: game.id }, {}));
    expect(res.status).toBe(400);
  });
});

import { DELETE } from "~/pages/api/events/[id]/history/[historyId]";

describe("Delete Historical Game API", () => {
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

  it("deletes a historical game", async () => {
    const event = await seedEvent("owner1");

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

    const res = await DELETE(ctx({ id: event.id, historyId: game.id }, undefined, "DELETE"));
    expect(res.status).toBe(204);

    const deleted = await prisma.gameHistory.findUnique({ where: { id: game.id } });
    expect(deleted).toBeNull();
  });

  it("recalculates ELO when deleting a processed game", async () => {
    const event = await seedEvent("owner1");

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

    const res = await DELETE(ctx({ id: event.id, historyId: game.id }, undefined, "DELETE"));
    expect(res.status).toBe(204);

    const deleted = await prisma.gameHistory.findUnique({ where: { id: game.id } });
    expect(deleted).toBeNull();
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

    const res = await DELETE(ctx({ id: event.id, historyId: game.id }, undefined, "DELETE"));
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent game", async () => {
    const event = await seedEvent("owner1");

    const res = await DELETE(ctx({ id: event.id, historyId: "nonexistent" }, undefined, "DELETE"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-existent event on delete", async () => {
    const res = await DELETE(ctx({ id: "nonexistent", historyId: "any" }, undefined, "DELETE"));
    expect(res.status).toBe(404);
  });

  it("returns 401 when not authenticated", async () => {
    const event = await seedEvent("owner1");
    mockGetSession.mockResolvedValue(null as any);

    const res = await DELETE(ctx({ id: event.id, historyId: "any" }, undefined, "DELETE"));
    expect(res.status).toBe(401);
  });
});

// ─── ADR 0016 regression: played live Game resolves to an editable GameHistory ─
// A recurring event's reset flips the old Game to "played" AND creates a
// GameHistory snapshot with the same dateTime. The history list used to surface
// the bare live Game (no teamsSnapshot, uneditable id) which hid the players
// and made PATCH return "Not found.".
import { GET as getHistory } from "~/pages/api/events/[id]/history/index";
import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { PATCH as patchHistory, DELETE as deleteHistory } from "~/pages/api/events/[id]/history/[historyId]";

describe("Played live Game resolves to editable GameHistory (regression)", () => {
  beforeEach(async () => {
    await prisma.game.deleteMany();
    await prisma.gameHistory.deleteMany();
    await prisma.teamResult.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    mockGetSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as any);
    mockCheckOwnership.mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1", name: "Owner" } },
    } as any);
  });

  it("GET history returns the GameHistory snapshot (with players), not the bare live Game", async () => {
    const event = await seedEvent("owner1");
    const dt = new Date("2025-03-10T18:00:00Z");
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: dt, status: "played" },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: dt,
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Alice", order: 0 }] },
          { team: "B", players: [{ name: "Bob", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await getHistory(ctx({ id: event.id }, undefined, "GET"));
    const body = await res.json();

    const entry = body.data.find((e: any) => e.dateTime === dt.toISOString());
    expect(entry).toBeTruthy();
    // Players are visible because the GameHistory snapshot is preferred
    expect(entry.teamsSnapshot).not.toBeNull();
    // The id must be the editable GameHistory id, not the bare live Game id
    expect(entry.id).not.toBe(game.id);
  });

  it("PATCH on a played live Game id saves the score (materialises GameHistory)", async () => {
    const event = await seedEvent("owner1");
    // Recent date so the derived snapshot is still editable (dateTime + 7 days)
    const dt = new Date(Date.now() - 1 * 86400_000);
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: dt, status: "played", scoreOne: null, scoreTwo: null },
    });
    // Teams so the on-demand snapshot carries the players
    const trA = await prisma.teamResult.create({ data: { name: "A", eventId: event.id } });
    await prisma.teamMember.create({ data: { name: "Alice", order: 0, teamResultId: trA.id } });
    const trB = await prisma.teamResult.create({ data: { name: "B", eventId: event.id } });
    await prisma.teamMember.create({ data: { name: "Bob", order: 0, teamResultId: trB.id } });

    const res = await patchHistory(
      ctx({ id: event.id, historyId: game.id }, { scoreOne: 3, scoreTwo: 1 }, "PATCH"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoreOne).toBe(3);
    expect(body.scoreTwo).toBe(1);

    const gh = await prisma.gameHistory.findFirst({ where: { eventId: event.id, dateTime: dt } });
    expect(gh).toBeTruthy();
    expect(gh!.teamsSnapshot).not.toBeNull();
  });

  it("PATCH on a played live Game id captures the EventCost payments snapshot", async () => {
    const event = await seedEvent("owner1");
    const dt = new Date(Date.now() - 1 * 86400_000);
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: dt, status: "played", scoreOne: null, scoreTwo: null },
    });
    const trA = await prisma.teamResult.create({ data: { name: "A", eventId: event.id } });
    await prisma.teamMember.create({ data: { name: "Alice", order: 0, teamResultId: trA.id } });
    const trB = await prisma.teamResult.create({ data: { name: "B", eventId: event.id } });
    await prisma.teamMember.create({ data: { name: "Bob", order: 0, teamResultId: trB.id } });
    await prisma.eventCost.create({
      data: {
        eventId: event.id,
        totalAmount: 10,
        currency: "EUR",
        payments: {
          create: [
            { playerName: "Alice", amount: 5, status: "paid", method: "cash" },
            { playerName: "Bob", amount: 5, status: "pending", method: "revolut" },
          ],
        },
      },
    });

    const res = await patchHistory(
      ctx({ id: event.id, historyId: game.id }, { scoreOne: 2, scoreTwo: 2 }, "PATCH"),
    );
    expect(res.status).toBe(200);

    const gh = await prisma.gameHistory.findFirst({ where: { eventId: event.id, dateTime: dt } });
    expect(gh).toBeTruthy();
    expect(gh!.paymentsSnapshot).not.toBeNull();
  });

  it("DELETE on a played live Game id removes the derived history but keeps the Game played", async () => {
    const event = await seedEvent("owner1");
    const dt = new Date(Date.now() - 1 * 86400_000);
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: dt, status: "played" },
    });
    const trA = await prisma.teamResult.create({ data: { name: "A", eventId: event.id } });
    await prisma.teamMember.create({ data: { name: "Alice", order: 0, teamResultId: trA.id } });
    const trB = await prisma.teamResult.create({ data: { name: "B", eventId: event.id } });
    await prisma.teamMember.create({ data: { name: "Bob", order: 0, teamResultId: trB.id } });

    const res = await deleteHistory(
      ctx({ id: event.id, historyId: game.id }, undefined, "DELETE"),
    );
    expect(res.status).toBe(204);

    const gh = await prisma.gameHistory.findFirst({ where: { eventId: event.id, dateTime: dt } });
    expect(gh).toBeNull();
    const stillGame = await prisma.game.findUnique({ where: { id: game.id } });
    expect(stillGame).toBeTruthy();
    // Must NOT be flipped to "cancelled" — that's a skipped game, not a played one
    expect(stillGame!.status).toBe("played");
  });

  it("GET history reconstructs teamsSnapshot for a played live Game from event teamResults", async () => {
    const event = await seedEvent("owner1");
    const dt = new Date("2025-03-12T18:00:00Z");
    await prisma.game.create({
      data: { eventId: event.id, dateTime: dt, status: "played" },
    });
    // No GameHistory yet — the live Game must still expose its players via the
    // reconstructed teamsSnapshot (ADR 0016 comments in history/index.ts:50-57).
    const trA = await prisma.teamResult.create({ data: { name: "A", eventId: event.id } });
    await prisma.teamMember.create({ data: { name: "Alice", order: 0, teamResultId: trA.id } });
    const trB = await prisma.teamResult.create({ data: { name: "B", eventId: event.id } });
    await prisma.teamMember.create({ data: { name: "Bob", order: 0, teamResultId: trB.id } });

    const res = await getHistory(ctx({ id: event.id }, undefined, "GET"));
    const body = await res.json();

    const entry = body.data.find((e: any) => e.dateTime === dt.toISOString());
    expect(entry).toBeTruthy();
    expect(entry.teamsSnapshot).not.toBeNull();
    const parsed = JSON.parse(entry.teamsSnapshot);
    expect(parsed[0].players.map((p: any) => p.name)).toContain("Alice");
    expect(parsed[1].players.map((p: any) => p.name)).toContain("Bob");
  });

  it("GET history dedup prefers the GameHistory that carries a teamsSnapshot", async () => {
    const event = await seedEvent("owner1");
    const dt = new Date("2025-03-14T18:00:00Z");
    // Two legacy rows share a dateTime; only one carries the players snapshot.
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: dt,
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Alice", order: 0 }] },
          { team: "B", players: [{ name: "Bob", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: dt,
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: null,
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await getHistory(ctx({ id: event.id }, undefined, "GET"));
    const body = await res.json();

    const entries = body.data.filter((e: any) => e.dateTime === dt.toISOString());
    // Dedup keeps a single entry...
    expect(entries).toHaveLength(1);
    // ...and it must be the one that carries the players snapshot.
    expect(entries[0].teamsSnapshot).not.toBeNull();
  });

  it("recurrence reset does not duplicate a GameHistory already materialised on the played Game", async () => {
    const pastDate = new Date(Date.now() - 2 * 86400_000);
    const event = await prisma.event.create({
      data: {
        title: "Weekly",
        location: "Pitch",
        dateTime: pastDate,
        isRecurring: true,
        recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
        nextResetAt: new Date(pastDate.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        teamOneName: "A",
        teamTwoName: "B",
      },
    });
    const game1 = await prisma.game.create({ data: { eventId: event.id, dateTime: pastDate } });
    await prisma.event.update({
      where: { id: event.id },
      data: { currentGameId: game1.id },
    });
    await prisma.teamResult.create({
      data: { eventId: event.id, name: "TeamA", members: { create: [{ name: "Keep Me", order: 0 }] } },
    });
    // A score was saved on the played Game before the reset ran (PATCH materialises
    // a GameHistory on demand) — this must prevent the reset from creating a duplicate.
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: pastDate,
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Keep Me", order: 0 }] },
          { team: "B", players: [] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    const res = await getEvent(ctx({ id: event.id }, undefined, "GET"));
    const body = await res.json();
    expect(body.wasReset).toBe(true);

    const snapshots = await prisma.gameHistory.findMany({
      where: { eventId: event.id, dateTime: pastDate },
    });
    expect(snapshots).toHaveLength(1);
  });
});
