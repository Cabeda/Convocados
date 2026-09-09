import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { hashPassword } from "~/lib/eventAccess";
import { GET as getSeason } from "~/pages/api/events/[id]/seasons/[seasonId]/index";
import { POST as recommend } from "~/pages/api/events/[id]/seasons/[seasonId]/crews/recommend";
import { POST as saveCrews } from "~/pages/api/events/[id]/seasons/[seasonId]/crews/index";
import { POST as createProposal } from "~/pages/api/events/[id]/seasons/[seasonId]/crew-proposals/index";
import { PATCH as decideProposal } from "~/pages/api/events/[id]/seasons/[seasonId]/crew-proposals/[proposalId]";

const mockGetSession = vi.fn();
const mockCheckEventAdmin = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: (...args: unknown[]) => mockCheckEventAdmin(...args),
}));

function context(params: Record<string, string>, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const request = new Request("http://localhost/api/events/test", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

async function seedEvent(password = false) {
  for (let index = 0; index < 8; index += 1) {
    const id = `crew-user-${index}`;
    await prisma.user.create({ data: { id, name: `Player ${index}`, email: `${id}@example.test` } });
  }
  return prisma.event.create({
    data: {
      title: "Crew Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "crew-user-0",
      accessPassword: password ? hashPassword("secret") : null,
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedSeason(eventId: string, count = 6) {
  const season = await prisma.season.create({
    data: {
      eventId,
      name: "September Season",
      registrationOpensAt: new Date(Date.now() - 86400_000),
      registrationClosesAt: new Date(Date.now() + 86400_000),
    },
  });
  const memberships = [];
  for (let index = 0; index < count; index += 1) {
    const eventPlayer = await prisma.eventPlayer.create({
      data: { eventId, name: `Player ${index}`, userId: `crew-user-${index}`, rating: 900 + index * 50 },
    });
    memberships.push(await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: eventPlayer.id, userId: `crew-user-${index}` },
    }));
    await prisma.playerRating.create({
      data: { eventId, name: eventPlayer.name, rating: 1000 + index * 50 },
    });
  }
  return { season, memberships };
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetApiRateLimitStore();
  await prisma.crew.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.season.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Crew Season setup", () => {
  it("returns public Crew names and hides admin diagnostics from public viewers", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    await prisma.crew.create({
      data: { seasonId: season.id, name: "North", sortOrder: 0, memberships: { connect: [{ id: memberships[0].id }, { id: memberships[1].id }, { id: memberships[2].id }] } },
    });

    const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.season.crews[0]).toMatchObject({ name: "North" });
    expect(body.season.crews[0].members[0]).toEqual({ name: "Player 0" });
    expect(body.season.crews[0].members[0].membershipId).toBeUndefined();
    expect(body.season.activeMembers).toBeUndefined();
  });

  it("requires event access even for an authenticated non-admin", async () => {
    const event = await seedEvent(true);
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-1" } });

    const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET"));

    expect(response.status).toBe(403);
  });

  it("previews balanced recommendations without creating Crews or assignments", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await recommend(context({ id: event.id, seasonId: season.id }, "POST", { crewCount: 2 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.crews).toHaveLength(2);
    expect(body.crews.flatMap((crew: { membershipIds: string[] }) => crew.membershipIds).sort()).toEqual(
      memberships.map((membership) => membership.id).sort(),
    );
    expect(await prisma.crew.count()).toBe(0);
    expect(await prisma.seasonMembership.count({ where: { crewId: { not: null } } })).toBe(0);
  });

  it("saves the starting date, names, and assignments atomically", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      startsAt: "2026-09-01T18:00:00.000Z",
      crews: [
        { name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id) },
        { name: "South", membershipIds: memberships.slice(3).map((membership) => membership.id) },
      ],
    }));

    expect(response.status).toBe(200);
    expect((await prisma.season.findUnique({ where: { id: season.id } }))?.startsAt?.toISOString()).toBe("2026-09-01T18:00:00.000Z");
    expect(await prisma.crew.count({ where: { seasonId: season.id } })).toBe(2);
    expect(await prisma.gameParticipant.count()).toBe(0);
  });

  it("rejects withdrawn, duplicate, and foreign memberships without partial writes", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const otherEvent = await prisma.event.create({ data: { title: "Other", location: "Other pitch", dateTime: new Date(), ownerId: "crew-user-0" } });
    const foreignPlayer = await prisma.eventPlayer.create({ data: { eventId: otherEvent.id, name: "Foreign", userId: "crew-user-7" } });
    const foreignMembership = await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: foreignPlayer.id, userId: "crew-user-7", status: "withdrawn" } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      startsAt: "not-a-date",
      crews: [
        { name: "North", membershipIds: [memberships[0].id, memberships[0].id, foreignMembership.id] },
        { name: "South", membershipIds: memberships.slice(1, 4).map((membership) => membership.id) },
      ],
    }));

    expect(response.status).toBe(400);
    expect(await prisma.crew.count()).toBe(0);
    expect((await prisma.season.findUnique({ where: { id: season.id } }))?.startsAt).toBeNull();
  });

  it("does not clear legacy cross-event membership assignments during a valid save", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const otherEvent = await prisma.event.create({ data: { title: "Other", location: "Other pitch", dateTime: new Date(), ownerId: "crew-user-0" } });
    const foreignPlayer = await prisma.eventPlayer.create({ data: { eventId: otherEvent.id, name: "Foreign", userId: "crew-user-7" } });
    const foreignMembership = await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: foreignPlayer.id, userId: "crew-user-7" } });
    const legacyCrew = await prisma.crew.create({ data: { seasonId: season.id, name: "Legacy", sortOrder: 0 } });
    await prisma.seasonMembership.update({ where: { id: foreignMembership.id }, data: { crewId: legacyCrew.id } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { id: legacyCrew.id, name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id) },
        { name: "South", membershipIds: memberships.slice(3).map((membership) => membership.id) },
      ],
    }));

    expect(response.status).toBe(200);
    expect((await prisma.seasonMembership.findUnique({ where: { id: foreignMembership.id } }))?.crewId).toBe(legacyCrew.id);
  });

  it("rejects deleting a Crew that has a legacy cross-event membership", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const otherEvent = await prisma.event.create({ data: { title: "Other", location: "Other pitch", dateTime: new Date(), ownerId: "crew-user-0" } });
    const foreignPlayer = await prisma.eventPlayer.create({ data: { eventId: otherEvent.id, name: "Foreign", userId: "crew-user-7" } });
    const foreignMembership = await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: foreignPlayer.id, userId: "crew-user-7" } });
    const legacyCrew = await prisma.crew.create({ data: { seasonId: season.id, name: "Legacy", sortOrder: 0 } });
    await prisma.seasonMembership.update({ where: { id: foreignMembership.id }, data: { crewId: legacyCrew.id } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id) },
        { name: "South", membershipIds: memberships.slice(3).map((membership) => membership.id) },
      ],
    }));

    expect(response.status).toBe(400);
    expect((await prisma.seasonMembership.findUnique({ where: { id: foreignMembership.id } }))?.crewId).toBe(legacyCrew.id);
    expect(await prisma.crew.count({ where: { id: legacyCrew.id } })).toBe(1);
  });

  it("preserves approved and pending proposal memberships during direct setup", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0", name: "Player 0" } });
    const pending = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Pending North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));
    expect(pending.status).toBe(201);

    const pendingSave = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id) },
        { name: "South", membershipIds: memberships.slice(3).map((membership) => membership.id) },
      ],
    }));
    expect(pendingSave.status).toBe(409);
    expect(await prisma.crew.count({ where: { seasonId: season.id } })).toBe(0);

    const approved = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: (await pending.json()).proposal.id }, "PATCH", { decision: "approve" }));
    expect(approved.status).toBe(200);
    const approvedCrew = await prisma.crew.findFirstOrThrow({ where: { seasonId: season.id } });
    const replacingSave = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [{ name: "South", membershipIds: memberships.slice(3).map((membership) => membership.id) }, { name: "Other", membershipIds: memberships.slice(0, 3).map((membership) => membership.id) }],
    }));
    expect(replacingSave.status).toBe(409);
    expect(await prisma.crew.findUnique({ where: { id: approvedCrew.id } })).not.toBeNull();
  });

  it("rejects pending proposals when direct setup happens after registration closes", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0", name: "Player 0" } });
    const pending = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Expired North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));
    const proposalId = (await pending.json()).proposal.id as string;
    await prisma.season.update({ where: { id: season.id }, data: { registrationClosesAt: new Date(Date.now() - 60_000) } });

    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id) },
        { name: "South", membershipIds: memberships.slice(3).map((membership) => membership.id) },
      ],
    }));

    expect(response.status).toBe(200);
    expect(await prisma.crewProposal.findUnique({ where: { id: proposalId }, select: { status: true, rejectionReason: true } })).toMatchObject({
      status: "rejected",
      rejectionReason: "Registration closed before this proposal was approved.",
    });
  });
});


  it("rejects null JSON bodies instead of throwing", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const recommendation = await recommend(context({ id: event.id, seasonId: season.id }, "POST", null));
    const save = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", null));

    expect(recommendation.status).toBe(400);
    expect(save.status).toBe(400);
  });


it("returns 404 for a Season that does not exist", async () => {
  const event = await seedEvent();
  const response = await getSeason(context({ id: event.id, seasonId: "no-such-season" }, "GET"));
  expect(response.status).toBe(404);
});

it("returns 404 when the Season belongs to another Event", async () => {
  const eventA = await seedEvent();
  const { season } = await seedSeason(eventA.id);
  const eventB = await prisma.event.create({
    data: { title: "Other", location: "X", dateTime: new Date(Date.now() + 86400_000), ownerId: "crew-user-0", eloEnabled: true, balanced: true },
  });
  const response = await getSeason(context({ id: eventB.id, seasonId: season.id }, "GET"));
  expect(response.status).toBe(404);
});

it("denies access to a password-protected Event without the cookie", async () => {
  const event = await seedEvent(true);
  const { season } = await seedSeason(event.id);
  mockGetSession.mockResolvedValue(null);
  const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET"));
  expect(response.status).toBe(403);
});

it("exposes admin diagnostics (activeMembers + crew ids) to the owner", async () => {
  const event = await seedEvent();
  const { season, memberships } = await seedSeason(event.id);
  await prisma.crew.create({
    data: { seasonId: season.id, name: "North", sortOrder: 0, memberships: { connect: [{ id: memberships[0].id }, { id: memberships[1].id }, { id: memberships[2].id }] } },
  });
  mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

  const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET"));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(Array.isArray(body.season.activeMembers)).toBe(true);
  expect(body.season.crews[0].id).toBeTruthy();
  expect(body.season.crews[0].members[0].membershipId).toBeTruthy();
});


it("rejects a crew with too few members", async () => {
  const event = await seedEvent();
  const { season, memberships } = await seedSeason(event.id);
  mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
  const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
    crews: [
      { name: "Tiny", membershipIds: [memberships[0].id, memberships[1].id] },
      { name: "Rest", membershipIds: [memberships[2].id, memberships[3].id, memberships[4].id] },
    ],
  }));
  expect(response.status).toBe(400);
});

it("rejects duplicate crew names", async () => {
  const event = await seedEvent();
  const { season, memberships } = await seedSeason(event.id);
  mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
  const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
    crews: [
      { name: "Same", membershipIds: [memberships[0].id, memberships[1].id, memberships[2].id] },
      { name: "same", membershipIds: [memberships[3].id, memberships[4].id, memberships[5].id] },
    ],
  }));
  expect(response.status).toBe(400);
});

it("rejects assigning one participant to multiple crews", async () => {
  const event = await seedEvent();
  const { season, memberships } = await seedSeason(event.id);
  mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
  const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
    crews: [
      { name: "One", membershipIds: [memberships[0].id, memberships[1].id, memberships[2].id] },
      { name: "Two", membershipIds: [memberships[2].id, memberships[3].id, memberships[4].id] },
    ],
  }));
  expect(response.status).toBe(400);
});

it("rejects fewer than two crews", async () => {
  const event = await seedEvent();
  const { season, memberships } = await seedSeason(event.id);
  mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
  const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
    crews: [{ name: "Only", membershipIds: [memberships[0].id, memberships[1].id, memberships[2].id] }],
  }));
  expect(response.status).toBe(400);
});
