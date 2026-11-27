import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { POST as randomize } from "~/pages/api/events/[id]/randomize";
import { POST as resetPlayerOrder } from "~/pages/api/events/[id]/reset-player-order";

// Ownerless unlisted event: the share link is the capability (ADR 0035), so
// these tests exercise the ended-game guard rather than the authorization gate.
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: false, isAdmin: false, session: null }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

function ctx(eventId: string, route: string) {
  const url = `http://localhost/api/events/${eventId}/${route}`;
  return {
    request: new Request(url, { method: "POST" }),
    params: { id: eventId },
    url: new URL(url),
  } as any;
}

async function seedEvent(ended: boolean) {
  return prisma.event.create({
    data: {
      title: "Ended Game",
      location: "Pitch",
      dateTime: ended ? new Date(Date.now() - 2 * 3600_000) : new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      maxPlayers: 10,
      teamOneName: "Reds",
      teamTwoName: "Blues",
    },
  });
}

async function seedPlayers(eventId: string) {
  await prisma.player.createMany({
    data: ["Alice", "Bob", "Carol", "Dave"].map((name, order) => ({ name, eventId, order })),
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

describe("ended Game freezes the roster write routes (#1787)", () => {
  it("randomize returns 409 once the Game has ended", async () => {
    const event = await seedEvent(true);
    await seedPlayers(event.id);

    const res = await randomize(ctx(event.id, "randomize"));
    expect(res.status).toBe(409);
  });

  it("reset-player-order returns 409 once the Game has ended", async () => {
    const event = await seedEvent(true);
    await seedPlayers(event.id);

    const res = await resetPlayerOrder(ctx(event.id, "reset-player-order"));
    expect(res.status).toBe(409);
  });

  it("keeps both routes writable before the Game ends", async () => {
    const event = await seedEvent(false);
    await seedPlayers(event.id);

    expect((await randomize(ctx(event.id, "randomize"))).status).toBe(200);
    expect((await resetPlayerOrder(ctx(event.id, "reset-player-order"))).status).toBe(200);
  });
});
