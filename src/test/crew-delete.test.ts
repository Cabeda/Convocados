import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { DELETE as deleteCrew } from "~/pages/api/events/[id]/seasons/[seasonId]/crews/[crewId]";

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
  for (let index = 0; index < 8; index += 1) {
    const id = `del-user-${index}`;
    await prisma.user.create({ data: { id, name: `Player ${index}`, email: `${id}@example.test` } });
  }
  return prisma.event.create({
    data: {
      title: "Delete Crew Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "del-user-0",
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedSeason(eventId: string, count = 6) {
  const season = await prisma.season.create({
    data: {
      eventId,
      name: "Delete Season",
      registrationOpensAt: new Date(Date.now() - 86400_000),
      registrationClosesAt: new Date(Date.now() + 86400_000),
    },
  });
  const memberships = [];
  for (let index = 0; index < count; index += 1) {
    const player = await prisma.eventPlayer.create({
      data: { eventId, name: `Player ${index}`, userId: `del-user-${index}` },
    });
    memberships.push(await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: player.id, userId: `del-user-${index}` },
    }));
  }
  return { season, memberships };
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  await resetApiRateLimitStore();
  await prisma.crewProposalMember.deleteMany();
  await prisma.crewProposal.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.season.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DELETE season crew", () => {
  it("requires authentication", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "North", sortOrder: 0, memberships: { connect: memberships.slice(0, 3).map((m) => ({ id: m.id })) } } });

    const response = await deleteCrew(context({ id: event.id, seasonId: season.id, crewId: crew.id }, "DELETE"));

    expect(response.status).toBe(401);
  });

  it("requires event admin rights", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "North", sortOrder: 0 } });
    mockGetSession.mockResolvedValue({ user: { id: "del-user-1" } });

    const response = await deleteCrew(context({ id: event.id, seasonId: season.id, crewId: crew.id }, "DELETE"));

    expect(response.status).toBe(403);
  });

  it("deletes the crew and unassigns its members", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "North", sortOrder: 0, memberships: { connect: memberships.slice(0, 3).map((m) => ({ id: m.id })) } } });
    mockGetSession.mockResolvedValue({ user: { id: "del-user-0" } });

    const response = await deleteCrew(context({ id: event.id, seasonId: season.id, crewId: crew.id }, "DELETE"));

    expect(response.status).toBe(200);
    expect(await prisma.crew.findUnique({ where: { id: crew.id } })).toBeNull();
    const remaining = await prisma.seasonMembership.findMany({ where: { id: { in: memberships.slice(0, 3).map((m) => m.id) } } });
    expect(remaining.every((membership) => membership.crewId === null)).toBe(true);
    // Members stay in the Season (unassigned), not withdrawn.
    expect(remaining.every((membership) => membership.status === "active")).toBe(true);
  });

  it("rejects deleting a crew that backs an approved proposal", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "North", sortOrder: 0, memberships: { connect: memberships.slice(0, 3).map((m) => ({ id: m.id })) } } });
    const proposal = await prisma.crewProposal.create({
      data: { seasonId: season.id, proposerMembershipId: memberships[0].id, name: "North", status: "approved", approvedCrewId: crew.id },
    });
    await prisma.crewProposalMember.create({ data: { proposalId: proposal.id, seasonMembershipId: memberships[0].id } });
    mockGetSession.mockResolvedValue({ user: { id: "del-user-0" } });

    const response = await deleteCrew(context({ id: event.id, seasonId: season.id, crewId: crew.id }, "DELETE"));

    expect(response.status).toBe(409);
    expect(await prisma.crew.findUnique({ where: { id: crew.id } })).not.toBeNull();
  });

  it("rejects deleting a crew with cross-event legacy members", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const otherEvent = await prisma.event.create({ data: { title: "Other", location: "Pitch", dateTime: new Date(), ownerId: "del-user-0" } });
    const foreignPlayer = await prisma.eventPlayer.create({ data: { eventId: otherEvent.id, name: "Foreign", userId: "del-user-7" } });
    const foreignMembership = await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: foreignPlayer.id, userId: "del-user-7" } });
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "North", sortOrder: 0, memberships: { connect: [{ id: memberships[0].id }, { id: foreignMembership.id }] } } });
    mockGetSession.mockResolvedValue({ user: { id: "del-user-0" } });

    const response = await deleteCrew(context({ id: event.id, seasonId: season.id, crewId: crew.id }, "DELETE"));

    expect(response.status).toBe(400);
  });

  it("returns 404 for a crew in another season", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    const otherSeason = await prisma.season.create({
      data: { eventId: event.id, name: "Other", status: "completed", registrationOpensAt: new Date(Date.now() - 90 * 86400_000), registrationClosesAt: new Date(Date.now() - 60 * 86400_000) },
    });
    const crew = await prisma.crew.create({ data: { seasonId: otherSeason.id, name: "Foreign", sortOrder: 0 } });
    mockGetSession.mockResolvedValue({ user: { id: "del-user-0" } });

    const response = await deleteCrew(context({ id: event.id, seasonId: season.id, crewId: crew.id }, "DELETE"));

    expect(response.status).toBe(404);
  });
});
