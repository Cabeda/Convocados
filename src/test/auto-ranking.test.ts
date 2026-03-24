import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { POST as addPlayer } from "~/pages/api/events/[id]/players";

function ctx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

async function seedEvent() {
  const event = await prisma.event.create({
    data: {
      title: "Auto Ranking Test",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
    },
  });
  return event.id;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.playerRating.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

describe("Auto-add players to ranking (#174)", () => {
  it("creates a PlayerRating entry when a player is added", async () => {
    const eventId = await seedEvent();
    await addPlayer(ctx({ id: eventId }, { name: "Alice" }));

    const rating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId, name: "Alice" } },
    });
    expect(rating).not.toBeNull();
    expect(rating!.rating).toBe(1000);
    expect(rating!.gamesPlayed).toBe(0);
    expect(rating!.wins).toBe(0);
    expect(rating!.draws).toBe(0);
    expect(rating!.losses).toBe(0);
  });

  it("does not overwrite an existing rating when player re-joins", async () => {
    const eventId = await seedEvent();

    // Pre-create a rating with custom values
    await prisma.playerRating.create({
      data: { eventId, name: "Bob", rating: 1200, gamesPlayed: 5, wins: 3, draws: 1, losses: 1 },
    });

    await addPlayer(ctx({ id: eventId }, { name: "Bob" }));

    const rating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId, name: "Bob" } },
    });
    expect(rating!.rating).toBe(1200);
    expect(rating!.gamesPlayed).toBe(5);
  });

  it("creates ratings for multiple players independently", async () => {
    const eventId = await seedEvent();
    await addPlayer(ctx({ id: eventId }, { name: "Charlie" }));
    await addPlayer(ctx({ id: eventId }, { name: "Diana" }));

    const ratings = await prisma.playerRating.findMany({
      where: { eventId },
      orderBy: { name: "asc" },
    });
    expect(ratings).toHaveLength(2);
    expect(ratings[0].name).toBe("Charlie");
    expect(ratings[1].name).toBe("Diana");
    expect(ratings[0].rating).toBe(1000);
    expect(ratings[1].rating).toBe(1000);
  });

  it("respects initialRating if one was pre-set before player joins", async () => {
    const eventId = await seedEvent();

    // Owner pre-sets an initial rating before the player joins
    await prisma.playerRating.create({
      data: { eventId, name: "Eve", rating: 1100, initialRating: 1100 },
    });

    await addPlayer(ctx({ id: eventId }, { name: "Eve" }));

    const rating = await prisma.playerRating.findUnique({
      where: { eventId_name: { eventId, name: "Eve" } },
    });
    expect(rating!.rating).toBe(1100);
    expect(rating!.initialRating).toBe(1100);
  });
});
