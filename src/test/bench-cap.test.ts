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

async function seedEvent(maxPlayers: number, sport = "football-5v5") {
  const event = await prisma.event.create({
    data: {
      title: "Bench Cap Test",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers,
      sport,
    },
  });
  return event.id;
}

async function addPlayers(eventId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const res = await addPlayer(ctx({ id: eventId }, { name: `Player ${i + 1}` }));
    const body = await res.json();
    if (!body.ok) throw new Error(`Failed to add player ${i + 1}: ${JSON.stringify(body)}`);
  }
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.notificationJob.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

describe("Bench player cap (#175)", () => {
  it("allows players up to maxPlayers on the bench (2x maxPlayers total)", { timeout: 30_000 }, async () => {
    const eventId = await seedEvent(2); // 2 active + 2 bench = 4 total
    // Add 2 active players
    await addPlayers(eventId, 2);
    // Add 2 bench players (should succeed)
    const res3 = await addPlayer(ctx({ id: eventId }, { name: "Bench 1" }));
    expect(res3.status).toBe(200);
    const res4 = await addPlayer(ctx({ id: eventId }, { name: "Bench 2" }));
    expect(res4.status).toBe(200);

    // 5th player should be rejected — bench is full
    const res5 = await addPlayer(ctx({ id: eventId }, { name: "Bench 3" }));
    expect(res5.status).toBe(400);
    const body5 = await res5.json();
    expect(body5.error).toContain("bench");
  });

  it("rejects players when bench is full for larger events", { timeout: 30_000 }, async () => {
    const eventId = await seedEvent(10); // 10 active + 10 bench = 20 total
    await addPlayers(eventId, 20); // fill all spots

    const res = await addPlayer(ctx({ id: eventId }, { name: "Too Many" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bench");
  });

  it("allows adding players when bench still has room", { timeout: 30_000 }, async () => {
    const eventId = await seedEvent(3); // 3 active + 3 bench = 6 total
    await addPlayers(eventId, 5); // 3 active + 2 bench

    // 6th player should still be allowed (1 bench spot left)
    const res = await addPlayer(ctx({ id: eventId }, { name: "Last Bench" }));
    expect(res.status).toBe(200);
  });

  it("returns correct error message with bench full info", async () => {
    const eventId = await seedEvent(2);
    await addPlayers(eventId, 4); // 2 active + 2 bench = full

    const res = await addPlayer(ctx({ id: eventId }, { name: "Overflow" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bench.*(full|maximum)/i);
  });
});
