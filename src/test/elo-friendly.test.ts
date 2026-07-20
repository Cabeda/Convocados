import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { processGame, recalculateAllRatings } from "~/lib/elo.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const eventId = "evt-friendly-elo";

async function makePlayedGame(isFriendly: boolean, scoreOne = 3, scoreTwo = 1) {
  return prisma.gameHistory.create({
    data: {
      eventId,
      dateTime: new Date(),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      scoreOne,
      scoreTwo,
      status: "played",
      isFriendly,
      editableUntil: new Date(Date.now() + 86400_000),
      teamsSnapshot: JSON.stringify([
        { team: "Ninjas", players: [{ name: "Alice", order: 0 }] },
        { team: "Gunas", players: [{ name: "Bob", order: 0 }] },
      ]),
    },
  });
}

beforeEach(async () => {
  await prisma.gameHistory.deleteMany({ where: { eventId } });
  await prisma.playerRating.deleteMany({ where: { eventId } });
  await prisma.event.deleteMany({ where: { id: eventId } });
  await prisma.event.create({ data: { id: eventId, title: "Friendly ELO Test", location: "Test", dateTime: new Date() } });
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("Friendly games do not affect ELO", () => {
  it("recalculateAllRatings skips friendly games", async () => {
    await makePlayedGame(false, 3, 1);
    await makePlayedGame(true, 10, 0); // friendly — should be ignored

    await recalculateAllRatings(eventId);

    const alice = await prisma.playerRating.findUnique({ where: { eventId_name: { eventId, name: "Alice" } } });
    const bob = await prisma.playerRating.findUnique({ where: { eventId_name: { eventId, name: "Bob" } } });
    expect(alice).not.toBeNull();
    expect(bob).not.toBeNull();
    // Only 1 game processed (the competitive one), not 2
    expect(alice!.gamesPlayed).toBe(1);
    expect(bob!.gamesPlayed).toBe(1);
  });

  it("processGame refuses to apply ELO to a friendly entry", async () => {
    const friendly = await makePlayedGame(true);

    const updates = await processGame(
      eventId,
      friendly.id,
      JSON.parse(friendly.teamsSnapshot!),
      friendly.scoreOne!,
      friendly.scoreTwo!,
    );

    expect(updates).toEqual([]);
    const ratings = await prisma.playerRating.findMany({ where: { eventId } });
    expect(ratings).toHaveLength(0);
    const entry = await prisma.gameHistory.findUnique({ where: { id: friendly.id } });
    expect(entry!.eloProcessed).toBe(false);
  });

  it("processGame is idempotent on already-processed games", async () => {
    const game = await makePlayedGame(false);
    await prisma.playerRating.create({ data: { eventId, name: "Alice", rating: 1000, gamesPlayed: 0 } });
    await prisma.playerRating.create({ data: { eventId, name: "Bob", rating: 1000, gamesPlayed: 0 } });

    // First call: applies ELO, marks processed
    await processGame(eventId, game.id, JSON.parse(game.teamsSnapshot!), game.scoreOne!, game.scoreTwo!);
    const aliceAfterFirst = await prisma.playerRating.findUnique({ where: { eventId_name: { eventId, name: "Alice" } } });
    const firstGamesPlayed = aliceAfterFirst!.gamesPlayed;

    // Second call: skipped, gamesPlayed unchanged
    const updates = await processGame(eventId, game.id, JSON.parse(game.teamsSnapshot!), game.scoreOne!, game.scoreTwo!);
    expect(updates).toEqual([]);
    const aliceAfterSecond = await prisma.playerRating.findUnique({ where: { eventId_name: { eventId, name: "Alice" } } });
    expect(aliceAfterSecond!.gamesPlayed).toBe(firstGamesPlayed);
  });
});
