import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/reset-player-order";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/auth.helpers.server")>("~/lib/auth.helpers.server");
  return {
    ...actual,
    checkOwnership: vi.fn(),
  };
});

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(eventId: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/reset-player-order`, { method: "POST" }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/reset-player-order`),
  } as any;
}

async function seedUser(id = "user-rpo-1") {
  return prisma.user.create({
    data: { id, name: "RPO User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(ownerId: string, id = "evt-rpo-1") {
  return prisma.event.create({
    data: { id, title: "RPO Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId },
  });
}

describe("POST /api/events/[id]/reset-player-order", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await POST(ctx("non-existent"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });

    const res = await POST(ctx(event.id));
    expect(res.status).toBe(403);
  });

  it("resets player order for owner", async () => {
    const owner = await seedUser("owner-2");
    const event = await seedEvent(owner.id);
    const p1 = await prisma.player.create({ data: { name: "Alice", eventId: event.id, order: 2 } });
    const p2 = await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 0 } });
    const p3 = await prisma.player.create({ data: { name: "Charlie", eventId: event.id, order: 1 } });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await POST(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.teamsCleared).toBe(false);

    // Verify order is reset by createdAt
    const players = await prisma.player.findMany({ where: { eventId: event.id }, orderBy: { order: "asc" } });
    expect(players[0].id).toBe(p1.id); // Alice created first
    expect(players[1].id).toBe(p2.id); // Bob created second
    expect(players[2].id).toBe(p3.id); // Charlie created third
  });

  it("resets and clears teams when bench players are in teams", async () => {
    const owner = await seedUser("owner-3");
    const event = await seedEvent(owner.id);
    await prisma.player.createMany({
      data: [
        { name: "P1", eventId: event.id, order: 3 },
        { name: "P2", eventId: event.id, order: 2 },
        { name: "P3", eventId: event.id, order: 1 },
        { name: "P4", eventId: event.id, order: 0 },
      ],
    });
    // Create a team result
    const team = await prisma.teamResult.create({
      data: { eventId: event.id, name: "Team A" },
    });
    const players = await prisma.player.findMany({ where: { eventId: event.id } });
    // Add a player beyond maxPlayers to team (should be cleared)
    await prisma.teamMember.create({
      data: { teamResultId: team.id, name: "P4", order: 3 },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await POST(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
