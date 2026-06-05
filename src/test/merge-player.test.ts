import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/merge-player";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  checkOwnership: vi.fn(),
  getSession: vi.fn(),
}));

const mockCheckOwnership = vi.mocked(checkOwnership);

function ctx(eventId: string, body: any, ownership: { isOwner: boolean; isAdmin: boolean }) {
  mockCheckOwnership.mockResolvedValue({ ...ownership, session: { user: { id: "owner", name: "Owner" } } } as any);
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/merge-player`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any;
}

async function seedEvent() {
  return prisma.event.create({
    data: { title: "Test", location: "Pitch", dateTime: new Date(Date.now() + 86400_000), maxPlayers: 10 },
  });
}

beforeEach(async () => {
  await prisma.mvpVote.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("POST /api/events/[id]/merge-player", () => {
  it("rejects non-admin/owner", async () => {
    const event = await seedEvent();
    const res = await POST(ctx(event.id, { sourceName: "A", targetName: "B" }, { isOwner: false, isAdmin: false }));
    expect(res.status).toBe(403);
  });

  it("rejects same source and target", async () => {
    const event = await seedEvent();
    const res = await POST(ctx(event.id, { sourceName: "A", targetName: "A" }, { isOwner: true, isAdmin: false }));
    expect(res.status).toBe(400);
  });

  it("rejects when neither player has a rating", async () => {
    const event = await seedEvent();
    const res = await POST(ctx(event.id, { sourceName: "Ghost", targetName: "Also Ghost" }, { isOwner: true, isAdmin: false }));
    expect(res.status).toBe(404);
  });

  it("merges source into target: renames in history, deletes source rating, recalculates ELO", async () => {
    const user = await prisma.user.create({ data: { id: "u1", name: "Gonçalo Silva", email: "g@t.com", emailVerified: true } });
    const event = await seedEvent();

    // Source: anonymous "Gonçalo" played 2 games
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Gonçalo", rating: 1050, gamesPlayed: 2, wins: 1, losses: 1 } });

    // Target: linked "Gonçalo Silva" played 1 game
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Gonçalo Silva", userId: user.id, rating: 1020, gamesPlayed: 1, wins: 1 } });

    // GameHistory with source name in snapshot
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2026-01-01"),
        teamOneName: "A",
        teamTwoName: "B",
        scoreOne: 3,
        scoreTwo: 1,
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Gonçalo", order: 0 }, { name: "Other", order: 1 }] },
          { team: "B", players: [{ name: "Rival", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
        eloProcessed: true,
      },
    });

    const res = await POST(ctx(event.id, { sourceName: "Gonçalo", targetName: "Gonçalo Silva" }, { isOwner: true, isAdmin: false }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.mergedInto).toBe("Gonçalo Silva");
    expect(json.userId).toBe(user.id);

    // Source rating deleted
    const sourceRating = await prisma.playerRating.findUnique({ where: { eventId_name: { eventId: event.id, name: "Gonçalo" } } });
    expect(sourceRating).toBeNull();

    // Target rating recalculated (now includes the merged game)
    const targetRating = await prisma.playerRating.findUnique({ where: { eventId_name: { eventId: event.id, name: "Gonçalo Silva" } } });
    expect(targetRating).not.toBeNull();
    expect(targetRating!.userId).toBe(user.id);
    expect(targetRating!.gamesPlayed).toBe(1); // recalculated from 1 game in history

    // History snapshot renamed
    const history = await prisma.gameHistory.findFirst({ where: { eventId: event.id } });
    const snapshot = JSON.parse(history!.teamsSnapshot!);
    expect(snapshot[0].players[0].name).toBe("Gonçalo Silva");
  });

  it("inherits userId from source when target has none", async () => {
    const user = await prisma.user.create({ data: { id: "u1", name: "Gonçalo Silva", email: "g@t.com", emailVerified: true } });
    const event = await seedEvent();

    // Source has userId (was linked before)
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Gonçalo", userId: user.id, rating: 1050, gamesPlayed: 3 } });
    // Target is anonymous
    await prisma.playerRating.create({ data: { eventId: event.id, name: "G. Silva", rating: 1000, gamesPlayed: 1 } });

    const res = await POST(ctx(event.id, { sourceName: "Gonçalo", targetName: "G. Silva" }, { isOwner: true, isAdmin: false }));
    expect(res.status).toBe(200);

    const targetRating = await prisma.playerRating.findUnique({ where: { eventId_name: { eventId: event.id, name: "G. Silva" } } });
    expect(targetRating!.userId).toBe(user.id);
  });

  it("updates MvpVote references", async () => {
    const event = await seedEvent();
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Gonçalo", rating: 1000 } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Gonçalo Silva", rating: 1000 } });

    const history = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date(),
        teamOneName: "A",
        teamTwoName: "B",
        teamsSnapshot: JSON.stringify([
          { team: "A", players: [{ name: "Gonçalo", order: 0 }] },
          { team: "B", players: [{ name: "Voter", order: 0 }] },
        ]),
        editableUntil: new Date(Date.now() + 86400_000),
      },
    });

    await prisma.mvpVote.create({
      data: { gameHistoryId: history.id, voterPlayerId: "p1", voterName: "Voter", votedForPlayerId: "p2", votedForName: "Gonçalo" },
    });

    const res = await POST(ctx(event.id, { sourceName: "Gonçalo", targetName: "Gonçalo Silva" }, { isOwner: true, isAdmin: false }));
    expect(res.status).toBe(200);

    const vote = await prisma.mvpVote.findFirst({ where: { gameHistoryId: history.id } });
    expect(vote!.votedForName).toBe("Gonçalo Silva");
  });

  it("deletes source Player record if present", async () => {
    const event = await seedEvent();
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Gonçalo", rating: 1000 } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Gonçalo Silva", rating: 1000 } });
    await prisma.player.create({ data: { name: "Gonçalo", eventId: event.id, order: 0 } });

    const res = await POST(ctx(event.id, { sourceName: "Gonçalo", targetName: "Gonçalo Silva" }, { isOwner: true, isAdmin: false }));
    expect(res.status).toBe(200);

    const sourcePlayer = await prisma.player.findFirst({ where: { eventId: event.id, name: "Gonçalo" } });
    expect(sourcePlayer).toBeNull();
  });
});
