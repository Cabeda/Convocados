import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma, Prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { hashPassword } from "~/lib/eventAccess";
import { POST as recommend } from "~/pages/api/events/[id]/seasons/[seasonId]/crews/recommend";
import { POST as saveCrews } from "~/pages/api/events/[id]/seasons/[seasonId]/crews/index";
import { GET as listProposals, POST as createProposal } from "~/pages/api/events/[id]/seasons/[seasonId]/crew-proposals/index";
import { PATCH as decideProposal } from "~/pages/api/events/[id]/seasons/[seasonId]/crew-proposals/[proposalId]";

const { mockSendPlayerInviteToRegister } = vi.hoisted(() => ({ mockSendPlayerInviteToRegister: vi.fn() }));
vi.mock("~/lib/email.server", () => ({ sendPlayerInviteToRegister: mockSendPlayerInviteToRegister }));

const mockGetSession = vi.fn();
const mockCheckEventAdmin = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: (...args: unknown[]) => mockCheckEventAdmin(...args),
}));

function context(params: Record<string, string>, method: string, body?: unknown, rawBody?: string) {
  const request = new Request("http://localhost/api/events/test", {
    method,
    headers: { "content-type": "application/json" },
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

async function seedUsers(count = 8) {
  for (let index = 0; index < count; index += 1) {
    const id = `crew-user-${index}`;
    await prisma.user.upsert({ where: { id }, update: {}, create: { id, name: `Player ${index}`, email: `${id}@example.test` } });
  }
}

async function seedEvent(password = false) {
  await seedUsers();
  return prisma.event.create({
    data: {
      title: "Crew Edge",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "crew-user-0",
      accessPassword: password ? hashPassword("secret") : null,
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedSeason(eventId: string, overrides: { status?: string; closes?: Date; opens?: Date; name?: string } = {}) {
  const season = await prisma.season.create({
    data: {
      eventId,
      name: overrides.name ?? "Edge Season",
      status: overrides.status ?? "registration",
      registrationOpensAt: overrides.opens ?? new Date(Date.now() - 86400_000),
      registrationClosesAt: overrides.closes ?? new Date(Date.now() + 86400_000),
    },
  });
  const memberships = [];
  for (let index = 0; index < 6; index += 1) {
    const eventPlayer = await prisma.eventPlayer.create({
      data: { eventId, name: `Player ${index}`, userId: `crew-user-${index}`, rating: 900 + index * 50 },
    });
    memberships.push(await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: eventPlayer.id, userId: `crew-user-${index}` },
    }));
  }
  return { season, memberships };
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  mockSendPlayerInviteToRegister.mockReset();
  await resetApiRateLimitStore();
  await prisma.crewProposalInvite.deleteMany();
  await prisma.crewProposalMember.deleteMany();
  await prisma.crewProposal.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.season.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function exhaust(handler: (ctx: APIContext) => Response | Promise<Response>) {
  for (let index = 0; index <= 30; index += 1) {
    await handler(context({ id: "none", seasonId: "none" }, "POST", {}));
  }
  return handler(context({ id: "none", seasonId: "none" }, "POST", {}));
}

describe("Crew setup (crews/index) edge cases", () => {
  it("requires authentication and rate limits", async () => {
    const anonymous = await saveCrews(context({ id: "none", seasonId: "none" }, "POST", { crews: [] }));
    expect(anonymous.status).toBe(401);
    const limited = await exhaust(saveCrews);
    expect(limited.status).toBe(429);
  });

  it("returns 404 without season params and for an unknown season", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const missing = await saveCrews(context({ id: event.id }, "POST", { crews: [] }));
    const unknown = await saveCrews(context({ id: event.id, seasonId: "missing" }, "POST", { crews: [] }));
    expect(missing.status).toBe(404);
    expect(unknown.status).toBe(404);
  });

  it("denies a non-admin with ordinary access", async () => {
    const event = await seedEvent(true);
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-1" } });
    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "A", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(response.status).toBe(403);
  });

  it("rejects an array body, invalid startsAt and too-few crews", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const arrayBody = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", [1]));
    const numericStart = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", { startsAt: 42, crews: [] }));
    const oneCrew = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [{ name: "Only", membershipIds: memberships.slice(0, 3).map((m) => m.id) }],
    }));
    expect(arrayBody.status).toBe(400);
    expect(numericStart.status).toBe(400);
    expect(oneCrew.status).toBe(400);
  });

  it("accepts startsAt: null to leave the start date unset", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      startsAt: null,
      crews: [
        { name: "A", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(response.status).toBe(200);
  });

  it("rejects non-string membership ids", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "A", membershipIds: [memberships[0].id, memberships[1].id, 5] },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(response.status).toBe(400);
  });

  it("rejects a non-string Crew id and duplicate Crew ids", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const numericId = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { id: 7, name: "A", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    const duplicateId = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { id: "dup", name: "A", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { id: "dup", name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(numericId.status).toBe(400);
    expect(duplicateId.status).toBe(400);
  });

  it("rejects an over-long Crew name and an oversized Crew", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    await seedUsers(10);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const longName = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "x".repeat(51), membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(longName.status).toBe(400);

    const extra = [];
    for (let index = 6; index < 9; index += 1) {
      const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: `Extra ${index}`, userId: `crew-user-${index}` } });
      extra.push(await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: ep.id, userId: `crew-user-${index}` } }));
    }
    const oversized = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "Big", membershipIds: [...memberships.slice(0, 3), ...extra].map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(oversized.status).toBe(400);
  });

  it("rejects a withdrawn membership and a Crew id from another Season", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const withdrawn = await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: (await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Gone", userId: "crew-user-7" } })).id, userId: "crew-user-7", status: "withdrawn" },
    });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const inactive = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "A", membershipIds: [memberships[0].id, memberships[1].id, withdrawn.id] },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    const foreign = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { id: "not-in-season", name: "A", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(inactive.status).toBe(400);
    expect(foreign.status).toBe(400);
  });

  it("protects approved proposal Crews and memberships", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "Approved", sortOrder: 0 } });
    const proposal = await prisma.crewProposal.create({
      data: {
        seasonId: season.id,
        proposerMembershipId: memberships[0].id,
        name: "Approved",
        status: "approved",
        approvedCrewId: crew.id,
        members: { create: memberships.slice(0, 3).map((m) => ({ seasonMembershipId: m.id })) },
      },
    });
    await prisma.seasonMembership.updateMany({ where: { id: { in: memberships.slice(0, 3).map((m) => m.id) } }, data: { crewId: crew.id } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const removed = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "A", membershipIds: memberships.slice(3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
      ],
    }));
    expect(removed.status).toBe(409);

    const changed = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { id: crew.id, name: "Approved", membershipIds: [memberships[0].id, memberships[1].id, memberships[4].id] },
        { name: "B", membershipIds: [memberships[2].id, memberships[3].id, memberships[5].id] },
      ],
    }));
    expect(changed.status).toBe(409);
    expect(proposal.id).toBeTruthy();
  });

  it("maps a unique conflict to 409 and rethrows unexpected errors", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const payload = {
      crews: [
        { name: "A", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    };
    const conflict = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );
    const mapped = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", payload));
    expect(mapped.status).toBe(409);
    conflict.mockRestore();

    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("boom"));
    await expect(saveCrews(context({ id: event.id, seasonId: season.id }, "POST", payload))).rejects.toThrow("boom");
  });
});

describe("Crew recommendations edge cases", () => {
  it("requires authentication and rate limits", async () => {
    const anonymous = await recommend(context({ id: "none", seasonId: "none" }, "POST", { crewCount: 2 }));
    expect(anonymous.status).toBe(401);
    const limited = await exhaust(recommend);
    expect(limited.status).toBe(429);
  });

  it("returns 404 without params and 403 for a non-admin", async () => {
    const event = await seedEvent(true);
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const missing = await recommend(context({ id: event.id }, "POST", { crewCount: 2 }));
    const unknown = await recommend(context({ id: event.id, seasonId: "missing" }, "POST", { crewCount: 2 }));
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-1" } });
    const denied = await recommend(context({ id: event.id, seasonId: season.id }, "POST", { crewCount: 2 }));
    expect(missing.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(denied.status).toBe(403);
  });

  it("rejects an array body and invalid crew counts", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const arrayBody = await recommend(context({ id: event.id, seasonId: season.id }, "POST", [1]));
    const oneCrew = await recommend(context({ id: event.id, seasonId: season.id }, "POST", { crewCount: 1 }));
    const float = await recommend(context({ id: event.id, seasonId: season.id }, "POST", { crewCount: 2.5 }));
    const text = await recommend(context({ id: event.id, seasonId: season.id }, "POST", { crewCount: "many" }));
    expect(arrayBody.status).toBe(400);
    expect(oneCrew.status).toBe(400);
    expect(float.status).toBe(400);
    expect(text.status).toBe(400);
  });

  it("parses a numeric string crew count and resolves ratings from all sources", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Player 0", userId: "crew-user-0", rating: 1400 } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: "Player 1", rating: 1300 } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await recommend(context({ id: event.id, seasonId: season.id }, "POST", { crewCount: "2" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.crews).toHaveLength(2);
    const allMembers = body.crews.flatMap((crew: { members: Array<{ rating: number }> }) => crew.members);
    expect(allMembers).toHaveLength(memberships.length);
    expect(allMembers.map((entry: { rating: number }) => entry.rating)).toEqual(expect.arrayContaining([1400, 1300]));
  });

  it("returns 422 when the roster cannot fill the requested Crews", async () => {
    const event = await seedEvent();
    const season = await prisma.season.create({
      data: { eventId: event.id, name: "Tiny", registrationOpensAt: new Date(Date.now() - 86400_000), registrationClosesAt: new Date(Date.now() + 86400_000) },
    });
    for (let index = 0; index < 2; index += 1) {
      const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: `Tiny ${index}`, userId: `crew-user-${index}` } });
      await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: ep.id, userId: `crew-user-${index}` } });
    }
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await recommend(context({ id: event.id, seasonId: season.id }, "POST", { crewCount: 2 }));

    expect(response.status).toBe(422);
  });
});

describe("Crew proposal listing and creation edge cases", () => {
  it("requires authentication and returns 404/403 for bad scope", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    const anonymous = await listProposals(context({ id: event.id, seasonId: season.id }, "GET"));
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const missing = await listProposals(context({ id: event.id }, "GET"));
    const unknown = await listProposals(context({ id: event.id, seasonId: "missing" }, "GET"));
    expect(anonymous.status).toBe(401);
    expect(missing.status).toBe(404);
    expect(unknown.status).toBe(404);
  });

  it("denies a private event and reports a closed Season", async () => {
    const event = await seedEvent(true);
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-1" } });
    const denied = await listProposals(context({ id: event.id, seasonId: season.id }, "GET"));
    expect(denied.status).toBe(403);

    const openEvent = await seedEvent();
    const closed = await seedSeason(openEvent.id, { status: "active" });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const closedResponse = await listProposals(context({ id: openEvent.id, seasonId: closed.season.id }, "GET"));
    expect(closedResponse.status).toBe(200);
    expect(await closedResponse.json()).toMatchObject({ proposals: [], closed: true });
  });

  it("returns an empty queue for a non-participant non-admin", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    await prisma.user.create({ data: { id: "outsider", name: "Outsider", email: "outsider@example.test" } });
    mockGetSession.mockResolvedValue({ user: { id: "outsider" } });
    const response = await listProposals(context({ id: event.id, seasonId: season.id }, "GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ proposals: [], canPropose: false, canReview: false });
  });

  it("offers unassigned event players as external candidates", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 6", userId: "crew-user-6" } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 7", userId: "crew-user-7" } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await listProposals(context({ id: event.id, seasonId: season.id }, "GET"));
    const body = await response.json();
    const names = body.candidates.map((candidate: { name: string }) => candidate.name);

    expect(response.status).toBe(200);
    expect(names).toContain("Player 6");
    expect(names).toContain("Player 7");
  });

  it("rejects malformed bodies when creating a proposal", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const arrayBody = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", [1]));
    const noMembers = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { name: "North" }));
    const longName = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { name: "x".repeat(51), membershipIds: memberships.slice(0, 3).map((m) => m.id) }));
    const junkMembers = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { name: "North", members: [1, 2, 3] }));
    const doubleIdentity = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North",
      members: [{ membershipId: memberships[0].id, userId: "crew-user-0" }, { membershipId: memberships[1].id }, { membershipId: memberships[2].id }],
    }));
    expect(arrayBody.status).toBe(400);
    expect(noMembers.status).toBe(400);
    expect(longName.status).toBe(400);
    expect(junkMembers.status).toBe(400);
    expect(doubleIdentity.status).toBe(400);
  });

  it("rejects unknown users and unacquainted users", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const unknown = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North",
      members: [{ membershipId: memberships[0].id }, { userId: "ghost" }, { membershipId: memberships[1].id }],
    }));
    expect(unknown.status).toBe(400);

    const stranger = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Strange",
      members: [{ membershipId: memberships[0].id }, { userId: "crew-user-7" }, { membershipId: memberships[1].id }],
    }));
    expect(stranger.status).toBe(403);
  });

  it("adopts a same-named EventPlayer and rejects a conflicting one", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const proposerEventPlayerId = memberships[0].eventPlayerId;
    // Give the target user a co-play history in a different Event so they pass
    // the "played together" gate without being an EventPlayer of this Event.
    async function grantCoPlay(userId: string) {
      const other = await prisma.event.create({ data: { title: "History", location: "X", dateTime: new Date(), ownerId: "crew-user-0" } });
      const targetPlayer = await prisma.eventPlayer.create({ data: { eventId: other.id, name: `History ${userId}`, userId } });
      const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - 86400_000), status: "played" } });
      await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: proposerEventPlayerId } });
      await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: targetPlayer.id } });
    }
    await grantCoPlay("crew-user-7");
    const adoptable = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 7" } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const adopted = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Adopt",
      members: [{ membershipId: memberships[0].id }, { userId: "crew-user-7" }, { membershipId: memberships[1].id }],
    }));
    expect(adopted.status).toBe(201);
    expect((await prisma.eventPlayer.findUnique({ where: { id: adoptable.id } }))?.userId).toBe("crew-user-7");

    // Now "Player 7" belongs to crew-user-7; another user with the same name collides.
    await prisma.user.create({ data: { id: "collide", name: "Player 7", email: "collide@example.test" } });
    await grantCoPlay("collide");
    const conflict = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Collide",
      members: [{ membershipId: memberships[2].id }, { userId: "collide" }, { membershipId: memberships[3].id }],
    }));
    expect(conflict.status).toBe(409);
  });

  it("rejects a conflicting membership and a duplicate selection", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const firstEventPlayer = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "X", userId: "crew-user-6" } });
    const secondEventPlayer = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Y", userId: "crew-user-6" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: secondEventPlayer.id, userId: "crew-user-6" } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const conflict = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Conflict",
      members: [{ membershipId: memberships[0].id }, { userId: "crew-user-6" }, { membershipId: memberships[1].id }],
    }));
    expect(conflict.status).toBe(409);

    const duplicate = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Dup",
      membershipIds: [memberships[0].id, memberships[0].id, memberships[1].id],
    }));
    expect(duplicate.status).toBe(400);
    expect(await prisma.seasonMembership.findFirst({ where: { eventPlayerId: firstEventPlayer.id } })).toBeNull();
  });

  it("rejects a membership from another Season and one already in a Crew", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const other = await prisma.season.create({ data: { eventId: event.id, name: "Other", status: "completed", registrationOpensAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 60_000) } });
    const foreign = await prisma.seasonMembership.create({
      data: { seasonId: other.id, eventPlayerId: (await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Foreign", userId: "crew-user-7" } })).id, userId: "crew-user-7" },
    });
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "Assigned", sortOrder: 0 } });
    await prisma.seasonMembership.update({ where: { id: memberships[1].id }, data: { crewId: crew.id } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const foreignResponse = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Foreign", membershipIds: [memberships[0].id, memberships[2].id, foreign.id],
    }));
    const assignedResponse = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Assigned", membershipIds: [memberships[0].id, memberships[1].id, memberships[2].id],
    }));
    expect(foreignResponse.status).toBe(400);
    expect(assignedResponse.status).toBe(409);
  });

  it("rejects a Crew name conflict and overlapping pending proposals", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    await prisma.crew.create({ data: { seasonId: season.id, name: "Taken", sortOrder: 0 } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const nameConflict = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Taken", membershipIds: memberships.slice(0, 3).map((m) => m.id),
    }));
    expect(nameConflict.status).toBe(409);

    const first = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "First", membershipIds: memberships.slice(0, 3).map((m) => m.id),
    }));
    expect(first.status).toBe(201);
    const secondProposal = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Second", membershipIds: memberships.slice(0, 3).map((m) => m.id),
    }));
    expect(secondProposal.status).toBe(409);

    mockGetSession.mockResolvedValue({ user: { id: "crew-user-1" } });
    const overlap = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Overlap", membershipIds: [memberships[1].id, memberships[4].id, memberships[5].id],
    }));
    expect(overlap.status).toBe(409);

    const existingProposal = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Again", membershipIds: memberships.slice(0, 3).map((m) => m.id),
    }));
    expect(existingProposal.status).toBe(409);
  });

  it("maps a unique conflict when creating a proposal and rethrows unexpected errors", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const payload = { name: "Race", membershipIds: memberships.slice(0, 3).map((m) => m.id) };
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );
    const conflict = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", payload));
    expect(conflict.status).toBe(409);

    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("boom"));
    await expect(createProposal(context({ id: event.id, seasonId: season.id }, "POST", payload))).rejects.toThrow("boom");
  });
});

describe("Crew proposal invite and claim edge cases", () => {
  it("validates the invite email and reuses a pending invite", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0", name: "Player 0" } });
    const invalid = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "nope" }));
    expect(invalid.status).toBe(400);

    const first = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "newbie@example.test" }));
    const second = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "newbie@example.test" }));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect((await first.json()).token).toBe((await second.json()).token);
  });

  it("returns a registered candidate and rejects withdrawn or assigned users", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const inEvent = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 6", userId: "crew-user-6" } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0", name: "Player 0" } });
    const candidate = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "crew-user-6@example.test" }));
    expect(candidate.status).toBe(200);
    expect(await candidate.json()).toMatchObject({ registered: true, invited: false });
    expect(inEvent.id).toBeTruthy();

    await prisma.seasonMembership.update({ where: { id: memberships[5].id }, data: { status: "withdrawn", withdrawnAt: new Date() } });
    const withdrawn = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "crew-user-5@example.test" }));
    expect(withdrawn.status).toBe(409);

    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "Assigned", sortOrder: 0 } });
    await prisma.seasonMembership.update({ where: { id: memberships[4].id }, data: { crewId: crew.id } });
    const assigned = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "crew-user-4@example.test" }));
    expect(assigned.status).toBe(409);
  });

  it("deletes a freshly-created invite when the email fails to send", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0", name: "Player 0" } });
    mockSendPlayerInviteToRegister.mockRejectedValueOnce(new Error("smtp down"));

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "fail@example.test" }));

    expect(response.status).toBe(502);
    expect(await prisma.crewProposalInvite.count({ where: { seasonId: season.id, email: "fail@example.test" } })).toBe(0);
  });

  it("rejects a closed Season, a missing token and an unknown invite", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const missingToken = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: "  " }));
    expect(missingToken.status).toBe(400);

    const unknown = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: "nope" }));
    expect(unknown.status).toBe(404);

    await prisma.season.update({ where: { id: season.id }, data: { status: "active" } });
    const closedSeason = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: "x" }));
    expect(closedSeason.status).toBe(409);
  });

  it("rejects a claimed invite and a mismatched email", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    const claimed = await prisma.crewProposalInvite.create({
      data: { seasonId: season.id, invitedByUserId: "crew-user-0", email: "invitee@example.test", token: "claimed", status: "claimed", claimedAt: new Date() },
    });
    const pending = await prisma.crewProposalInvite.create({
      data: { seasonId: season.id, invitedByUserId: "crew-user-0", email: "someone@example.test", token: "pending" },
    });
    await prisma.user.create({ data: { id: "invitee", name: "Invitee", email: "other@example.test" } });
    mockGetSession.mockResolvedValue({ user: { id: "invitee" } });

    const claimedResponse = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: claimed.token }));
    const mismatch = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: pending.token }));
    expect(claimedResponse.status).toBe(409);
    expect(mismatch.status).toBe(403);
  });
});

describe("Crew proposal decisions edge cases", () => {
  async function seedProposalFixture() {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    return { event, season, memberships };
  }

  it("requires auth, valid scope and an open registration", async () => {
    const { event, season } = await seedProposalFixture();
    const anonymous = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: "x" }, "PATCH", { decision: "approve" }));
    expect(anonymous.status).toBe(401);

    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const unknown = await decideProposal(context({ id: event.id, seasonId: "missing", proposalId: "x" }, "PATCH", { decision: "approve" }));
    expect(unknown.status).toBe(404);

    const publicEvent = await seedEvent(true);
    const closed = await seedSeason(publicEvent.id, { status: "active" });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const closedResponse = await decideProposal(context({ id: publicEvent.id, seasonId: closed.season.id, proposalId: "x" }, "PATCH", { decision: "approve" }));
    expect(closedResponse.status).toBe(409);
  });

  it("validates the decision and rejection reason", async () => {
    const { event, season } = await seedProposalFixture();
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const arrayBody = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: "x" }, "PATCH", [1]));
    const badDecision = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: "x" }, "PATCH", { decision: "maybe" }));
    const badReason = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: "x" }, "PATCH", { decision: "reject", rejectionReason: 5 }));
    const longReason = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: "x" }, "PATCH", { decision: "reject", rejectionReason: "x".repeat(501) }));
    expect(arrayBody.status).toBe(400);
    expect(badDecision.status).toBe(400);
    expect(badReason.status).toBe(400);
    expect(longReason.status).toBe(400);
  });

  it("returns 404 for a missing proposal and 409 for an already-reviewed one", async () => {
    const { event, season, memberships } = await seedProposalFixture();
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const missing = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: "missing" }, "PATCH", { decision: "approve" }));
    expect(missing.status).toBe(404);

    const reviewed = await prisma.crewProposal.create({
      data: { seasonId: season.id, proposerMembershipId: memberships[0].id, name: "Reviewed", status: "rejected", members: { create: memberships.slice(0, 3).map((m) => ({ seasonMembershipId: m.id })) } },
    });
    const again = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: reviewed.id }, "PATCH", { decision: "approve" }));
    expect(again.status).toBe(409);
  });

  it("rejects an undersized crew and one missing the proposer", async () => {
    const { event, season, memberships } = await seedProposalFixture();
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const small = await prisma.crewProposal.create({
      data: { seasonId: season.id, proposerMembershipId: memberships[0].id, name: "Small", members: { create: memberships.slice(0, 2).map((m) => ({ seasonMembershipId: m.id })) } },
    });
    const smallResponse = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: small.id }, "PATCH", { decision: "approve" }));
    expect(smallResponse.status).toBe(409);

    const noProposer = await prisma.crewProposal.create({
      data: { seasonId: season.id, proposerMembershipId: memberships[5].id, name: "No Proposer", members: { create: memberships.slice(0, 3).map((m) => ({ seasonMembershipId: m.id })) } },
    });
    const noProposerResponse = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: noProposer.id }, "PATCH", { decision: "approve" }));
    expect(noProposerResponse.status).toBe(409);
  });

  it("rejects inactive members and a duplicate Crew name", async () => {
    const { event, season, memberships } = await seedProposalFixture();
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    await prisma.seasonMembership.update({ where: { id: memberships[0].id }, data: { status: "withdrawn", withdrawnAt: new Date() } });
    const inactive = await prisma.crewProposal.create({
      data: { seasonId: season.id, proposerMembershipId: memberships[0].id, name: "Inactive", members: { create: memberships.slice(0, 3).map((m) => ({ seasonMembershipId: m.id })) } },
    });
    const inactiveResponse = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: inactive.id }, "PATCH", { decision: "approve" }));
    expect(inactiveResponse.status).toBe(409);

    await prisma.seasonMembership.update({ where: { id: memberships[0].id }, data: { status: "active", withdrawnAt: null } });
    await prisma.crew.create({ data: { seasonId: season.id, name: "Taken", sortOrder: 0 } });
    const nameConflict = await prisma.crewProposal.create({
      data: { seasonId: season.id, proposerMembershipId: memberships[0].id, name: "Taken", members: { create: memberships.slice(3, 6).map((m) => ({ seasonMembershipId: m.id })) } },
    });
    const conflictResponse = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: nameConflict.id }, "PATCH", { decision: "approve" }));
    expect(conflictResponse.status).toBe(409);
  });

  it("maps a unique conflict on approval and rethrows unexpected errors", async () => {
    const { event, season, memberships } = await seedProposalFixture();
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const proposal = await prisma.crewProposal.create({
      data: { seasonId: season.id, proposerMembershipId: memberships[0].id, name: "Race", members: { create: memberships.slice(0, 3).map((m) => ({ seasonMembershipId: m.id })) } },
    });
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );
    const conflict = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: proposal.id }, "PATCH", { decision: "approve" }));
    expect(conflict.status).toBe(409);

    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("boom"));
    await expect(decideProposal(context({ id: event.id, seasonId: season.id, proposalId: proposal.id }, "PATCH", { decision: "approve" }))).rejects.toThrow("boom");
  });
});

describe("Crew setup and recommendation remaining branches", () => {
  it("returns 404 with a missing seasonId and 403 for a non-admin with access", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const missing = await saveCrews(context({ id: event.id }, "POST", { crews: [] }));
    expect(missing.status).toBe(404);

    mockGetSession.mockResolvedValue({ user: { id: "crew-user-1" } });
    const notAdmin = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "A", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(notAdmin.status).toBe(403);
  });

  it("rejects a non-string Crew name and a non-array membership list", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const badName = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: 5, membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    const badList = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { name: "A", membershipIds: "nope" },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(badName.status).toBe(400);
    expect(badList.status).toBe(400);
  });

  it("rejects an approved proposal Crew with a mismatched membership count", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "Approved", sortOrder: 0 } });
    await prisma.crewProposal.create({
      data: {
        seasonId: season.id,
        proposerMembershipId: memberships[0].id,
        name: "Approved",
        status: "approved",
        approvedCrewId: crew.id,
        members: { create: memberships.slice(0, 2).map((m) => ({ seasonMembershipId: m.id })) },
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const response = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { id: crew.id, name: "Approved", membershipIds: memberships.slice(0, 3).map((m) => m.id) },
        { name: "B", membershipIds: memberships.slice(3).map((m) => m.id) },
      ],
    }));
    expect(response.status).toBe(409);
  });

  it("returns 404/403 for recommendations with bad scope", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const missing = await recommend(context({ id: event.id }, "POST", { crewCount: 2 }));
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-1" } });
    const notAdmin = await recommend(context({ id: event.id, seasonId: season.id }, "POST", { crewCount: 2 }));
    expect(missing.status).toBe(404);
    expect(notAdmin.status).toBe(403);
  });
});

describe("Crew proposals remaining branches", () => {
  it("rate limits proposal writes and validates scope", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const missing = await createProposal(context({ id: event.id }, "POST", { name: "X" }));
    const unknown = await createProposal(context({ id: event.id, seasonId: "missing" }, "POST", { name: "X" }));
    expect(missing.status).toBe(404);
    expect(unknown.status).toBe(404);

    const limited = await exhaust(createProposal);
    expect(limited.status).toBe(429);
  });

  it("denies a private event before proposing", async () => {
    const event = await seedEvent(true);
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-1" } });
    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Private", membershipIds: memberships.slice(0, 3).map((m) => m.id),
    }));
    expect(response.status).toBe(403);
  });

  it("rejects non-string names, tokens and membership ids", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const badName = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { name: 5, membershipIds: memberships.slice(0, 3).map((m) => m.id) }));
    const badToken = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: 5 }));
    const badIds = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { name: "Bad", membershipIds: [memberships[0].id, 5, memberships[1].id] }));
    expect(badName.status).toBe(400);
    expect(badToken.status).toBe(400);
    expect(badIds.status).toBe(400);
  });

  it("resolves a member described by email", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "By Email",
      members: [{ membershipId: memberships[0].id }, { email: "ghost@example.test" }, { membershipId: memberships[1].id }],
    }));
    expect(response.status).toBe(400);
  });

  it("reactivates an existing active membership resolved by user id", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "By User",
      members: [{ membershipId: memberships[0].id }, { userId: "crew-user-1" }, { membershipId: memberships[2].id }],
    }));
    expect(response.status).toBe(201);
  });

  it("creates a new EventPlayer for a co-play acquaintance", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const proposerEventPlayerId = memberships[0].eventPlayerId;
    const other = await prisma.event.create({ data: { title: "History", location: "X", dateTime: new Date(), ownerId: "crew-user-0" } });
    const targetPlayer = await prisma.eventPlayer.create({ data: { eventId: other.id, name: "History 6", userId: "crew-user-6" } });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - 86400_000), status: "played" } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: proposerEventPlayerId } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: targetPlayer.id } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Newcomer",
      members: [{ membershipId: memberships[0].id }, { userId: "crew-user-6" }, { membershipId: memberships[1].id }],
    }));

    expect(response.status).toBe(201);
    expect(await prisma.eventPlayer.count({ where: { eventId: event.id, userId: "crew-user-6" } })).toBe(1);
  });

  it("lowercases invite emails and reports an unacquainted registered user", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0" } });
    const upper = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "NEWBIE@Example.Test" }));
    expect(upper.status).toBe(202);
    expect((await upper.json()).email).toBe("newbie@example.test");

    const unacquainted = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "crew-user-7@example.test" }));
    expect(unacquainted.status).toBe(403);
  });

  it("keeps an existing invite when a resend fails", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-0", name: "Player 0" } });
    const first = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "resend@example.test" }));
    expect(first.status).toBe(202);

    mockSendPlayerInviteToRegister.mockRejectedValueOnce(new Error("smtp down"));
    const second = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "invite", email: "resend@example.test" }));
    expect(second.status).toBe(502);
    expect(await prisma.crewProposalInvite.count({ where: { seasonId: season.id, email: "resend@example.test" } })).toBe(1);
  });

  it("handles invite claims for existing, withdrawn and conflicting members", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    await prisma.user.create({ data: { id: "invitee", name: "Clone", email: "clone@example.test" } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Clone", userId: "crew-user-6" } });
    await prisma.crewProposalInvite.create({ data: { seasonId: season.id, invitedByUserId: "crew-user-0", email: "clone@example.test", token: "clone-token" } });
    mockGetSession.mockResolvedValue({ user: { id: "invitee" } });
    const clone = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: "clone-token" }));
    expect(clone.status).toBe(409);

    const activePlayer = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Active", userId: "crew-user-7" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: activePlayer.id, userId: "crew-user-7" } });
    await prisma.crewProposalInvite.create({ data: { seasonId: season.id, invitedByUserId: "crew-user-0", email: "crew-user-7@example.test", token: "active-token" } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-7" } });
    const active = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: "active-token" }));
    expect(active.status).toBe(200);

    await prisma.seasonMembership.update({
      where: { seasonId_userId: { seasonId: season.id, userId: "crew-user-5" } },
      data: { status: "withdrawn", withdrawnAt: new Date() },
    });
    await prisma.crewProposalInvite.create({ data: { seasonId: season.id, invitedByUserId: "crew-user-0", email: "crew-user-5@example.test", token: "withdrawn-token" } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-5" } });
    const withdrawn = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: "withdrawn-token" }));
    expect(withdrawn.status).toBe(200);
    expect((await withdrawn.json()).membership.status).toBe("active");
  });

  it("rejects a claimed invite whose account maps to another EventPlayer", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    const first = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "First", userId: "crew-user-7" } });
    const other = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Other", userId: "crew-user-7" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: other.id, userId: "crew-user-7" } });
    await prisma.crewProposalInvite.create({ data: { seasonId: season.id, invitedByUserId: "crew-user-0", email: "crew-user-7@example.test", token: "conflict-token" } });
    mockGetSession.mockResolvedValue({ user: { id: "crew-user-7" } });
    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", { action: "claim-invite", token: "conflict-token" }));
    expect(response.status).toBe(409);
    expect(first.id).not.toBe(other.id);
  });
});
