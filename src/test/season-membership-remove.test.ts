import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { DELETE as removeMember } from "~/pages/api/events/[id]/seasons/[seasonId]/memberships/[membershipId]";

const mockGetSession = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: async () => false,
}));

function context(params: Record<string, string>, method: string) {
  const request = new Request("http://localhost/api/events/test", { method });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

async function seedEvent() {
  for (let index = 0; index < 3; index += 1) {
    const id = `rm-user-${index}`;
    await prisma.user.create({ data: { id, name: `Player ${index}`, email: `${id}@example.test` } });
  }
  return prisma.event.create({
    data: {
      title: "Remove Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "rm-user-0",
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedSeason(eventId: string) {
  const season = await prisma.season.create({
    data: {
      eventId,
      name: "Remove Season",
      registrationOpensAt: new Date(Date.now() - 86400_000),
      registrationClosesAt: new Date(Date.now() + 86400_000),
    },
  });
  const player = await prisma.eventPlayer.create({ data: { eventId, name: "Player 1", userId: "rm-user-1" } });
  const membership = await prisma.seasonMembership.create({
    data: { seasonId: season.id, eventPlayerId: player.id, userId: "rm-user-1" },
  });
  return { season, membership };
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  await resetApiRateLimitStore();
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

describe("DELETE season membership (admin remove)", () => {
  it("requires authentication", async () => {
    const event = await seedEvent();
    const { season, membership } = await seedSeason(event.id);

    const response = await removeMember(context({ id: event.id, seasonId: season.id, membershipId: membership.id }, "DELETE"));

    expect(response.status).toBe(401);
  });

  it("requires event admin rights", async () => {
    const event = await seedEvent();
    const { season, membership } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "rm-user-1" } });

    const response = await removeMember(context({ id: event.id, seasonId: season.id, membershipId: membership.id }, "DELETE"));

    expect(response.status).toBe(403);
  });

  it("withdraws the membership but keeps the row for history", async () => {
    const event = await seedEvent();
    const { season, membership } = await seedSeason(event.id);
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "North", sortOrder: 0 } });
    await prisma.seasonMembership.update({ where: { id: membership.id }, data: { crewId: crew.id } });
    mockGetSession.mockResolvedValue({ user: { id: "rm-user-0" } });

    const response = await removeMember(context({ id: event.id, seasonId: season.id, membershipId: membership.id }, "DELETE"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.membership).toMatchObject({ id: membership.id, status: "withdrawn" });
    expect(body.membership.withdrawnAt).toBeTruthy();
    const row = await prisma.seasonMembership.findUnique({ where: { id: membership.id } });
    expect(row?.status).toBe("withdrawn");
    expect(row?.crewId).toBe(crew.id);
  });

  it("is idempotent for already-withdrawn members", async () => {
    const event = await seedEvent();
    const { season, membership } = await seedSeason(event.id);
    await prisma.seasonMembership.update({
      where: { id: membership.id },
      data: { status: "withdrawn", withdrawnAt: new Date() },
    });
    mockGetSession.mockResolvedValue({ user: { id: "rm-user-0" } });

    const response = await removeMember(context({ id: event.id, seasonId: season.id, membershipId: membership.id }, "DELETE"));

    expect(response.status).toBe(200);
  });

  it("returns 404 for unknown memberships", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "rm-user-0" } });

    const response = await removeMember(context({ id: event.id, seasonId: season.id, membershipId: "missing" }, "DELETE"));

    expect(response.status).toBe(404);
  });
});
