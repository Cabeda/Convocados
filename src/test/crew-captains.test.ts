import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as getSeason } from "~/pages/api/events/[id]/seasons/[seasonId]/index";
import { GET as listProposals, POST as createProposal } from "~/pages/api/events/[id]/seasons/[seasonId]/crew-proposals/index";
import { PATCH as decideProposal } from "~/pages/api/events/[id]/seasons/[seasonId]/crew-proposals/[proposalId]";
import { POST as saveCrews } from "~/pages/api/events/[id]/seasons/[seasonId]/crews/index";

const mockGetSession = vi.fn();
const mockCheckEventAdmin = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: (...args: unknown[]) => mockCheckEventAdmin(...args),
}));

const OWNER = "captain-owner";

function context(params: Record<string, string>, method: string, body?: unknown) {
  const request = new Request(`http://localhost/api/events/test`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

/** Owner does not play: no SeasonMembership. The crew holds players 1, 2 and 3. */
async function seedCrew() {
  await prisma.user.create({ data: { id: OWNER, name: "Owner", email: `${OWNER}@example.test` } });
  for (let index = 1; index <= 6; index += 1) {
    await prisma.user.create({ data: { id: `captain-user-${index}`, name: `Player ${index}`, email: `captain-user-${index}@example.test` } });
  }
  const event = await prisma.event.create({
    data: {
      title: "Captains Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: OWNER,
      balanced: true,
    },
  });
  const season = await prisma.season.create({
    data: {
      eventId: event.id,
      name: "Captains Season",
      status: "registration",
      registrationOpensAt: new Date(Date.now() - 86400_000),
      registrationClosesAt: new Date(Date.now() + 86400_000),
    },
  });
  const memberships = [];
  for (let index = 1; index <= 6; index += 1) {
    const eventPlayer = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: `Player ${index}`, userId: `captain-user-${index}` },
    });
    memberships.push(await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: eventPlayer.id, userId: `captain-user-${index}` },
    }));
  }
  const crew = await prisma.crew.create({ data: { seasonId: season.id, name: "North", sortOrder: 0 } });
  await prisma.seasonMembership.updateMany({
    where: { id: { in: memberships.slice(0, 3).map((membership) => membership.id) } },
    data: { crewId: crew.id },
  });
  return { event, season, crew, memberships };
}

/** The owner nominates, the nominee accepts — the state every captain test starts from. */
async function nominateAndAccept(eventId: string, seasonId: string, crewId: string, membershipId: string) {
  mockGetSession.mockResolvedValue({ user: { id: OWNER } });
  const created = await createProposal(context({ id: eventId, seasonId }, "POST", { action: "captain", crewId, membershipId }));
  const proposalId = (await created.json()).proposal.id;
  const nomineeUserId = (await prisma.seasonMembership.findUniqueOrThrow({ where: { id: membershipId } })).userId;
  mockGetSession.mockResolvedValue({ user: { id: nomineeUserId } });
  const accepted = await decideProposal(context({ id: eventId, seasonId, proposalId }, "PATCH", { decision: "accept" }));
  expect(accepted.status).toBe(200);
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetApiRateLimitStore();
  await prisma.crewProposalInvite.deleteMany();
  await prisma.crewProposalMember.deleteMany();
  await prisma.crewProposal.deleteMany();
  await prisma.crew.updateMany({ data: { captainMembershipId: null } });
  await prisma.crew.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.season.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Crew captains", () => {
  it("lets the owner nominate a crew member as captain without playing", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    mockGetSession.mockResolvedValue({ user: { id: OWNER } });

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "captain", crewId: crew.id, membershipId: memberships[0].id,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.proposal).toMatchObject({
      kind: "add", status: "pending", targetCrewId: crew.id, targetCrewName: "North", memberNames: ["Player 1"],
    });
    expect(body.proposal.proposerName).toBe("Owner");
    expect(body.proposal.awaitingMyAcceptance).toBe(false);
    const stored = await prisma.crewProposal.findFirstOrThrow();
    expect(stored.proposerMembershipId).toBeNull();
    expect(stored.proposedByUserId).toBe(OWNER);
    expect((await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } })).captainMembershipId).toBeNull();
  });

  it("stays pending until the nominee accepts, and only the nominee can accept", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const created = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "captain", crewId: crew.id, membershipId: memberships[0].id,
    }));
    const proposalId = (await created.json()).proposal.id;
    const path = { id: event.id, seasonId: season.id, proposalId };

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-2" } });
    const otherMember = await decideProposal(context(path, "PATCH", { decision: "accept" }));
    expect(otherMember.status).toBe(403);

    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const organizerApprove = await decideProposal(context(path, "PATCH", { decision: "approve" }));
    expect(organizerApprove.status).toBe(409);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const accepted = await decideProposal(context(path, "PATCH", { decision: "accept" }));
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).proposal.status).toBe("approved");
    expect((await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } })).captainMembershipId).toBe(memberships[0].id);
    expect(await prisma.crewProposalMember.count({ where: { proposalId, action: "add" } })).toBe(1);

    const repeated = await decideProposal(context(path, "PATCH", { decision: "accept" }));
    expect(repeated.status).toBe(409);
  });

  it("lets an accepted captain propose a player change on their own crew", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    await nominateAndAccept(event.id, season.id, crew.id, memberships[0].id);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const added = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "add", crewId: crew.id, membershipIds: [memberships[3].id],
    }));
    const addedBody = await added.json();
    expect(added.status).toBe(201);
    expect(addedBody.proposal).toMatchObject({ kind: "add", targetCrewId: crew.id, proposerName: "Player 1", memberNames: ["Player 4"] });

    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const approved = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: addedBody.proposal.id }, "PATCH", { decision: "approve" }));
    expect(approved.status).toBe(200);
    expect((await prisma.seasonMembership.findUniqueOrThrow({ where: { id: memberships[3].id } })).crewId).toBe(crew.id);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const dropped = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "remove", crewId: crew.id, membershipIds: [memberships[1].id],
    }));
    const droppedBody = await dropped.json();
    expect(dropped.status).toBe(201);
    expect(droppedBody.proposal).toMatchObject({ kind: "remove", targetCrewId: crew.id });

    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    await decideProposal(context({ id: event.id, seasonId: season.id, proposalId: droppedBody.proposal.id }, "PATCH", { decision: "approve" }));
    expect((await prisma.seasonMembership.findUniqueOrThrow({ where: { id: memberships[1].id } })).crewId).toBeNull();
  });

  it("keeps the create-only guards out of a captain's way, and its proposals out of theirs", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    await nominateAndAccept(event.id, season.id, crew.id, memberships[0].id);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const first = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "add", crewId: crew.id, membershipIds: [memberships[3].id],
    }));
    const second = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "add", crewId: crew.id, membershipIds: [memberships[4].id],
    }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-4" } });
    const create = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "South", membershipIds: memberships.slice(3, 6).map((membership) => membership.id),
    }));
    expect(create.status).toBe(201);
  });

  it("rejects a captain's proposal for another crew, and their own removal", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    const otherCrew = await prisma.crew.create({ data: { seasonId: season.id, name: "South", sortOrder: 1 } });
    await nominateAndAccept(event.id, season.id, crew.id, memberships[0].id);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const foreignCrew = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "add", crewId: otherCrew.id, membershipIds: [memberships[3].id],
    }));
    expect(foreignCrew.status).toBe(403);

    const selfRemoval = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "remove", crewId: crew.id, membershipIds: [memberships[0].id],
    }));
    expect(selfRemoval.status).toBe(409);
    expect(await prisma.crewProposal.count({ where: { kind: { in: ["add", "remove"] }, status: "pending" } })).toBe(0);
  });

  it("shows the captain on the Season crews and the offer to its nominee", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    await nominateAndAccept(event.id, season.id, crew.id, memberships[0].id);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-2" } });
    const participantSeason = await (await getSeason(context({ id: event.id, seasonId: season.id }, "GET"))).json();
    expect(participantSeason.season.crews[0]).toMatchObject({ name: "North", captainMembershipId: memberships[0].id, captainName: "Player 1" });

    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const adminSeason = await (await getSeason(context({ id: event.id, seasonId: season.id }, "GET"))).json();
    expect(adminSeason.season.crews[0]).toMatchObject({ captainMembershipId: memberships[0].id, captainName: "Player 1" });

    const nomination = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "captain", crewId: crew.id, membershipId: memberships[1].id,
    }));
    expect(nomination.status).toBe(201);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-2" } });
    const nominee = await (await listProposals(context({ id: event.id, seasonId: season.id }, "GET"))).json();
    expect(nominee.proposals).toHaveLength(1);
    expect(nominee.proposals[0]).toMatchObject({ targetCrewName: "North", memberNames: ["Player 2"], awaitingMyAcceptance: true });

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-3" } });
    const bystander = await (await listProposals(context({ id: event.id, seasonId: season.id }, "GET"))).json();
    expect(bystander.proposals).toHaveLength(0);
    expect((await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } })).captainMembershipId).toBe(memberships[0].id);
  });

  it("keeps a captain nomination pending past registration, and the nominee still accepts it", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const nomination = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "captain", crewId: crew.id, membershipId: memberships[0].id,
    }));
    expect(nomination.status).toBe(201);
    const proposalId = (await nomination.json()).proposal.id;
    await prisma.season.update({ where: { id: season.id }, data: { registrationClosesAt: new Date(Date.now() - 1_000) } });

    const saved = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { id: crew.id, name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id) },
        { name: "South", membershipIds: memberships.slice(3, 6).map((membership) => membership.id) },
      ],
    }));
    expect(saved.status).toBe(200);
    expect((await prisma.crewProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("pending");

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const offer = await (await listProposals(context({ id: event.id, seasonId: season.id }, "GET"))).json();
    expect(offer.proposals).toHaveLength(1);
    expect(offer.proposals[0]).toMatchObject({ awaitingMyAcceptance: true, captainNomination: true });

    const accepted = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", { decision: "accept" }));
    expect(accepted.status).toBe(200);
    expect((await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } })).captainMembershipId).toBe(memberships[0].id);
  });

  it("refuses to accept a nomination whose nominee left the crew", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const nomination = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "captain", crewId: crew.id, membershipId: memberships[0].id,
    }));
    const proposalId = (await nomination.json()).proposal.id;
    const otherCrew = await prisma.crew.create({ data: { seasonId: season.id, name: "South", sortOrder: 1 } });
    await prisma.seasonMembership.update({ where: { id: memberships[0].id }, data: { crewId: otherCrew.id } });

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const accepted = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", { decision: "accept" }));

    expect(accepted.status).toBe(409);
    expect((await accepted.json()).error).toContain("Crew");
    expect((await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } })).captainMembershipId).toBeNull();
  });

  it("refuses to approve a captain's change once the captain has been replaced", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    await nominateAndAccept(event.id, season.id, crew.id, memberships[0].id);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const added = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "add", crewId: crew.id, membershipIds: [memberships[3].id],
    }));
    const proposalId = (await added.json()).proposal.id;
    await nominateAndAccept(event.id, season.id, crew.id, memberships[2].id);

    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const approved = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", { decision: "approve" }));

    expect(approved.status).toBe(409);
    expect((await approved.json()).error).toContain("captain has changed");
    expect((await prisma.seasonMembership.findUniqueOrThrow({ where: { id: memberships[3].id } })).crewId).toBeNull();
  });

  it("refuses to approve a removal that would strip the current captain", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    await nominateAndAccept(event.id, season.id, crew.id, memberships[0].id);

    mockGetSession.mockResolvedValue({ user: { id: "captain-user-1" } });
    const dropped = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "remove", crewId: crew.id, membershipIds: [memberships[1].id],
    }));
    const proposalId = (await dropped.json()).proposal.id;
    // Direct setup can hand the captaincy to the very member being removed.
    await prisma.crew.update({ where: { id: crew.id }, data: { captainMembershipId: memberships[1].id } });

    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const approved = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", { decision: "approve" }));

    expect(approved.status).toBe(409);
    expect((await approved.json()).error).toContain("current captain");
    expect((await prisma.seasonMembership.findUniqueOrThrow({ where: { id: memberships[1].id } })).crewId).toBe(crew.id);
  });

  it("clears a crew's captain when direct setup moves them to another crew", async () => {
    const { event, season, crew, memberships } = await seedCrew();
    await nominateAndAccept(event.id, season.id, crew.id, memberships[0].id);

    mockGetSession.mockResolvedValue({ user: { id: OWNER } });
    const saved = await saveCrews(context({ id: event.id, seasonId: season.id }, "POST", {
      crews: [
        { id: crew.id, name: "North", membershipIds: memberships.slice(1, 4).map((membership) => membership.id) },
        { name: "South", membershipIds: [memberships[0].id, memberships[4].id, memberships[5].id] },
      ],
    }));

    expect(saved.status).toBe(200);
    expect((await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } })).captainMembershipId).toBeNull();
  });
});
