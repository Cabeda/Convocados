import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { applyRosterChange } from "~/lib/applyRosterChange.server";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

async function seedEvent(maxPlayers: number) {
  return prisma.event.create({
    data: {
      title: "Seam Test",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers,
      sport: "football-5v5",
    },
  });
}

async function loadEvent(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!event) throw new Error("seed event missing");
  return event;
}

function input(event: Awaited<ReturnType<typeof loadEvent>>, body: Record<string, unknown>) {
  return {
    eventId: event.id,
    origin: "http://localhost",
    session: null,
    senderClientId: undefined,
    body,
    event,
  };
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.notificationJob.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("applyRosterChange seam (c5)", () => {
  it("rejects with the bench-full gate", async () => {
    const seeded = await seedEvent(1); // 1 active + 1 bench = 2 total
    await prisma.player.create({ data: { name: "A", eventId: seeded.id, order: 0 } });
    await prisma.player.create({ data: { name: "B", eventId: seeded.id, order: 1 } });

    const result = await applyRosterChange(input(await loadEvent(seeded.id), { name: "C" }));

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/bench.*(full|maximum)/i);
  });

  it("rejects a missing player name", async () => {
    const seeded = await seedEvent(5);
    const result = await applyRosterChange(input(await loadEvent(seeded.id), { name: "   " }));
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("Player name is required");
  });

  it("applies a fresh join and returns the ok payload", async () => {
    const seeded = await seedEvent(5);
    const result = await applyRosterChange(input(await loadEvent(seeded.id), { name: "New Player" }));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, invited: null, resolvedName: "New Player", anonymous: true });

    const player = await prisma.player.findFirst({ where: { eventId: seeded.id, name: "New Player" } });
    expect(player).toBeTruthy();

    const rating = await prisma.playerRating.findFirst({ where: { eventId: seeded.id, name: "New Player" } });
    expect(rating?.rating).toBe(1000);
  });
});
