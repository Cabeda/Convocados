import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as getSeason } from "~/pages/api/events/[id]/seasons/[seasonId]/index";
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

function context(params: Record<string, string>, method: string, body?: unknown, query = "") {
  const request = new Request(`http://localhost/api/events/test${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

async function seedEvent() {
  for (let index = 0; index < 8; index += 1) {
    const id = `proposal-user-${index}`;
    await prisma.user.create({ data: { id, name: `Player ${index}`, email: `${id}@example.test` } });
  }
  return prisma.event.create({
    data: {
      title: "Proposal Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "proposal-user-0",
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedSeason(eventId: string, status = "registration") {
  const season = await prisma.season.create({
    data: {
      eventId,
      name: "Proposal Season",
      status,
      registrationOpensAt: new Date(Date.now() - 86400_000),
      registrationClosesAt: new Date(Date.now() + 86400_000),
    },
  });
  const memberships = [];
  for (let index = 0; index < 6; index += 1) {
    const eventPlayer = await prisma.eventPlayer.create({
      data: { eventId, name: `Player ${index}`, userId: `proposal-user-${index}`, rating: 900 + index * 50 },
    });
    memberships.push(await prisma.seasonMembership.create({
      data: { seasonId: season.id, eventPlayerId: eventPlayer.id, userId: `proposal-user-${index}` },
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
  await prisma.season.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Crew proposals", () => {
  it("requires authentication and active Season participation to submit", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);

    const anonymous = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));
    expect(anonymous.status).toBe(401);

    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-7" } });
    const nonParticipant = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));
    expect(nonParticipant.status).toBe(403);
  });

  it("validates 3–5 active members and requires the proposer among them", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0" } });

    const tooSmall = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North", membershipIds: memberships.slice(0, 2).map((membership) => membership.id),
    }));
    const proposerOmitted = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "South", membershipIds: memberships.slice(1, 4).map((membership) => membership.id),
    }));

    expect(tooSmall.status).toBe(400);
    expect(proposerOmitted.status).toBe(400);
    expect(await prisma.crewProposal.count()).toBe(0);
  });

  it("creates a pending proposal without creating a Crew", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0" } });

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.proposal).toMatchObject({ name: "North", status: "pending" });
    expect(await prisma.crew.count()).toBe(0);
    expect(await prisma.seasonMembership.count({ where: { crewId: { not: null } } })).toBe(0);
  });

  it("returns only the participant's proposals, while admins receive the review queue", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0" } });
    await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));

    const participantResponse = await listProposals(context({ id: event.id, seasonId: season.id }, "GET"));
    const participantBody = await participantResponse.json();
    expect(participantResponse.status).toBe(200);
    expect(participantBody.canPropose).toBe(true);
    expect(participantBody.proposals).toHaveLength(1);
    expect(participantBody.proposals[0].memberNames).toEqual(["Player 0", "Player 1", "Player 2"]);

    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-7" } });
    mockCheckEventAdmin.mockResolvedValue(true);
    const adminResponse = await listProposals(context({ id: event.id, seasonId: season.id }, "GET"));
    const adminBody = await adminResponse.json();
    expect(adminResponse.status).toBe(200);
    expect(adminBody.canReview).toBe(true);
    expect(adminBody.proposals).toHaveLength(1);
  });

  it("approves atomically and assigns the proposed memberships", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0" } });
    const created = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));
    const proposalId = (await created.json()).proposal.id;

    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0" } });
    const response = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", { decision: "approve" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.status).toBe("approved");
    expect(await prisma.crew.count({ where: { seasonId: season.id, name: "North" } })).toBe(1);
    expect(await prisma.seasonMembership.count({ where: { seasonId: season.id, crewId: { not: null } } })).toBe(3);

    const repeated = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", { decision: "approve" }));
    expect(repeated.status).toBe(409);
  });

  it("rejects without creating a Crew and records the reason", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0" } });
    const created = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "South", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));
    const proposalId = (await created.json()).proposal.id;

    const response = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", {
      decision: "reject", rejectionReason: "Please choose a different name.",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal).toMatchObject({ status: "rejected", rejectionReason: "Please choose a different name." });
    expect(await prisma.crew.count()).toBe(0);
  });

  it("does not allow participants to review or mutations after registration", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-1" } });
    const created = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "North", membershipIds: memberships.slice(1, 4).map((membership) => membership.id),
    }));
    const proposalId = (await created.json()).proposal.id;

    const participantDecision = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", { decision: "approve" }));
    expect(participantDecision.status).toBe(403);

    await prisma.season.update({ where: { id: season.id }, data: { status: "active" } });
    const closedSubmission = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "South", membershipIds: memberships.slice(1, 4).map((membership) => membership.id),
    }));
    expect(closedSubmission.status).toBe(409);
  });
});


describe("Crew proposal candidate resolution", () => {
  it("enrolls a registered Event user not yet in the Season when submitting", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 6", userId: "proposal-user-6" } });
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0", name: "Player 0" } });

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Mixed", members: [
        { membershipId: memberships[0].id },
        { userId: "proposal-user-6", name: "Player 6" },
        { membershipId: memberships[1].id },
      ],
    }));

    expect(response.status).toBe(201);
    const newMembership = await prisma.seasonMembership.findUnique({
      where: { seasonId_userId: { seasonId: season.id, userId: "proposal-user-6" } },
    });
    expect(newMembership?.status).toBe("active");
    expect((await response.json()).proposal.memberNames).toEqual(["Player 0", "Player 6", "Player 1"]);
  });

  it("sends a registration invitation for an unknown email", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0", name: "Player 0" } });

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "invite", email: "new-player@example.test",
    }));

    expect(response.status).toBe(202);
    const inviteBody = await response.json();
    expect(inviteBody).toMatchObject({ invited: true, email: "new-player@example.test" });
    expect(mockSendPlayerInviteToRegister).toHaveBeenCalledTimes(1);
    expect(await prisma.crewProposalInvite.count({ where: { seasonId: season.id, email: "new-player@example.test", status: "pending" } })).toBe(1);

    await prisma.user.create({ data: { id: "proposal-new-user", name: "New Player", email: "new-player@example.test" } });
    mockGetSession.mockResolvedValue({ user: { id: "proposal-new-user", name: "New Player", email: "new-player@example.test" } });
    const claim = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "claim-invite", token: inviteBody.token,
    }));
    expect(claim.status).toBe(200);
    expect((await claim.json()).membership.userId).toBe("proposal-new-user");

    const scopedSeason = await getSeason(context({ id: event.id, seasonId: season.id }, "GET", undefined, `?crewInviteToken=${encodeURIComponent(inviteBody.token)}`));
    expect(scopedSeason.status).toBe(200);
  });

  it("allows an admin to reject without a reason", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0", name: "Player 0" } });
    const created = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "No reason", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));
    const proposalId = (await created.json()).proposal.id;

    const response = await decideProposal(context({ id: event.id, seasonId: season.id, proposalId }, "PATCH", {
      decision: "reject", rejectionReason: "",
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).proposal).toMatchObject({ status: "rejected", rejectionReason: null });
  });

  it("blocks proposal mutations outside the registration window", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    await prisma.season.update({
      where: { id: season.id },
      data: { registrationOpensAt: new Date(Date.now() + 60_000) },
    });
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0", name: "Player 0" } });

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Too early", membershipIds: memberships.slice(0, 3).map((membership) => membership.id),
    }));

    expect(response.status).toBe(409);
  });

  it("allows a valid token claim for a private Event without ordinary Event access", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { accessPassword: "private-event" } });
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0", name: "Player 0" } });
    const invitation = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "invite", email: "invitee@example.test",
    }));
    const token = (await invitation.json()).token as string;

    await prisma.user.create({ data: { id: "proposal-invitee", name: "Invitee", email: "invitee@example.test" } });
    mockGetSession.mockResolvedValue({ user: { id: "proposal-invitee", name: "Invitee", email: "invitee@example.test" } });
    const claim = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "claim-invite", token,
    }));

    expect(claim.status).toBe(200);
  });

  it("does not re-enroll a participant who withdrew from the Season", async () => {
    const event = await seedEvent();
    const { season, memberships } = await seedSeason(event.id);
    const eventPlayer = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Player 6", userId: "proposal-user-6" } });
    const withdrawn = await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: eventPlayer.id, userId: "proposal-user-6", status: "withdrawn", withdrawnAt: new Date() } });
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0", name: "Player 0" } });

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      name: "Withdrawn", members: [
        { membershipId: memberships[0].id },
        { userId: "proposal-user-6" },
        { membershipId: memberships[1].id },
      ],
    }));

    expect(response.status).toBe(409);
    expect((await prisma.seasonMembership.findUnique({ where: { id: withdrawn.id } }))?.status).toBe("withdrawn");
  });

  it("does not offer a registered user outside the Event or co-play boundary", async () => {
    const event = await seedEvent();
    const { season } = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "proposal-user-0", name: "Player 0" } });

    const response = await createProposal(context({ id: event.id, seasonId: season.id }, "POST", {
      action: "invite", email: "proposal-user-7@example.test",
    }));

    expect(response.status).toBe(403);
  });
});
