import type { APIRoute } from "astro";
import { prisma, Prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { sendPlayerInviteToRegister } from "~/lib/email.server";
import { authorizeSeasonRequest, getSeasonForEvent, isSeasonRegistrationOpen } from "~/lib/seasonSetup.server";

const proposalInclude = {
  proposerMembership: { include: { eventPlayer: { select: { name: true } } } },
  members: {
    orderBy: { id: "asc" as const },
    include: { seasonMembership: { include: { eventPlayer: { select: { name: true } } } } },
  },
} as const;

type ProposalMemberInput = {
  membershipId?: string;
  userId?: string;
  email?: string;
  name?: string;
};

class ProposalInputError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function serializeProposal(proposal: Awaited<ReturnType<typeof prisma.crewProposal.findFirst<{ include: typeof proposalInclude }>>>) {
  if (!proposal) return null;
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    proposerName: proposal.proposerMembership.eventPlayer.name,
    memberNames: proposal.members.map((member) => member.seasonMembership.eventPlayer.name),
    rejectionReason: proposal.rejectionReason,
    approvedCrewId: proposal.approvedCrewId,
    createdAt: proposal.createdAt,
    reviewedAt: proposal.reviewedAt,
  };
}

function parseMemberInputs(body: { members?: unknown; membershipIds?: unknown }): ProposalMemberInput[] | null {
  if (Array.isArray(body.members)) {
    return body.members.map((member) => {
      if (!member || typeof member !== "object" || Array.isArray(member)) return {};
      const value = member as Record<string, unknown>;
      return {
        membershipId: typeof value.membershipId === "string" ? value.membershipId.trim() : undefined,
        userId: typeof value.userId === "string" ? value.userId.trim() : undefined,
        email: typeof value.email === "string" ? value.email.trim().toLowerCase() : undefined,
        name: typeof value.name === "string" ? value.name.trim() : undefined,
      };
    });
  }
  if (Array.isArray(body.membershipIds)) {
    return body.membershipIds.map((id) => ({ membershipId: typeof id === "string" ? id.trim() : undefined }));
  }
  return null;
}

async function resolveProposalMemberships(
  tx: Prisma.TransactionClient,
  eventId: string,
  seasonId: string,
  proposerUserId: string,
  inputs: ProposalMemberInput[],
) {
  const membershipIds: string[] = [];
  for (const input of inputs) {
    const identities = [input.membershipId, input.userId, input.email].filter(Boolean);
    if (identities.length !== 1) throw new ProposalInputError(400, "Each Crew member must identify one Season membership, user, or email.");

    if (input.membershipId) {
      membershipIds.push(input.membershipId);
      continue;
    }

    const user = input.userId
      ? await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true } })
      : await tx.user.findUnique({ where: { email: input.email }, select: { id: true, name: true } });
    if (!user) throw new ProposalInputError(400, "This person must register before they can join a Crew proposal.");

    const eventPlayerInEvent = await tx.eventPlayer.findFirst({ where: { eventId, userId: user.id } });
    const playedTogether = eventPlayerInEvent ? true : await tx.gameParticipant.findFirst({
      where: {
        eventPlayer: { userId: user.id },
        status: "active",
        archivedAt: null,
        game: { participants: { some: { eventPlayer: { userId: proposerUserId }, status: "active", archivedAt: null } } },
      },
      select: { id: true },
    });
    if (!playedTogether) throw new ProposalInputError(403, "Choose a player from this Event or someone you have played with.");

    let eventPlayer = eventPlayerInEvent;
    if (!eventPlayer) {
      const displayName = user.name.trim().slice(0, 50);
      const sameName = await tx.eventPlayer.findUnique({ where: { eventId_name: { eventId, name: displayName } } });
      if (sameName && sameName.userId && sameName.userId !== user.id) {
        throw new ProposalInputError(409, "This user conflicts with another Event player using the same name.");
      }
      eventPlayer = sameName
        ? await tx.eventPlayer.update({ where: { id: sameName.id }, data: { userId: user.id } })
        : await tx.eventPlayer.create({ data: { eventId, name: displayName, userId: user.id } });
    }

    const existing = await tx.seasonMembership.findUnique({ where: { seasonId_userId: { seasonId, userId: user.id } } });
    if (existing && existing.eventPlayerId !== eventPlayer.id) {
      throw new ProposalInputError(409, "This account is already registered with another Event player.");
    }
    if (existing?.status === "withdrawn") {
      throw new ProposalInputError(409, "This person has withdrawn from the Season and must rejoin before being proposed.");
    }
    const membership = existing
      ? await tx.seasonMembership.update({ where: { id: existing.id }, data: { status: "active", withdrawnAt: null } })
      : await tx.seasonMembership.create({ data: { seasonId, eventPlayerId: eventPlayer.id, userId: user.id } });
    membershipIds.push(membership.id);
  }
  return membershipIds;
}

async function getAuthorizedSeason(eventId: string, seasonId: string, request: Request) {
  const season = await getSeasonForEvent(seasonId, eventId);
  if (!season) return { season: null, authz: null, session: null };
  const session = await getSession(request);
  const authz = await authorizeSeasonRequest(season, session, request);
  return { season, authz, session };
}

async function claimInvite(
  season: NonNullable<Awaited<ReturnType<typeof getSeasonForEvent>>>,
  userId: string,
  token: string,
) {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.crewProposalInvite.findUnique({ where: { token } });
    if (!invite || invite.seasonId !== season.id) throw new ProposalInputError(404, "Crew invitation not found.");
    if (invite.status !== "pending") throw new ProposalInputError(409, "This Crew invitation has already been claimed.");
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
    if (!user || user.email.toLowerCase() !== invite.email) throw new ProposalInputError(403, "This invitation was sent to a different email address.");

    let eventPlayer = await tx.eventPlayer.findFirst({ where: { eventId: season.eventId, userId: user.id } });
    if (!eventPlayer) {
      const displayName = user.name.trim().slice(0, 50);
      const sameName = await tx.eventPlayer.findUnique({ where: { eventId_name: { eventId: season.eventId, name: displayName } } });
      if (sameName && sameName.userId && sameName.userId !== user.id) throw new ProposalInputError(409, "Your account conflicts with another Event player using the same name.");
      eventPlayer = sameName
        ? await tx.eventPlayer.update({ where: { id: sameName.id }, data: { userId: user.id } })
        : await tx.eventPlayer.create({ data: { eventId: season.eventId, name: displayName, userId: user.id } });
    }

    const existing = await tx.seasonMembership.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId: user.id } } });
    if (existing && existing.eventPlayerId !== eventPlayer.id) throw new ProposalInputError(409, "Your account is already registered with another Event player.");
    const membership = existing?.status === "active"
      ? existing
      : existing
        ? await tx.seasonMembership.update({ where: { id: existing.id }, data: { status: "active", withdrawnAt: null } })
        : await tx.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: eventPlayer.id, userId: user.id } });
    await tx.crewProposalInvite.update({ where: { id: invite.id }, data: { status: "claimed", claimedByUserId: user.id, claimedAt: new Date() } });
    return membership;
  });
}

export const GET: APIRoute = async ({ params, request }) => {
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { season, authz } = await getAuthorizedSeason(params.id ?? "", params.seasonId ?? "", request);
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  if (!authz?.allowed) return Response.json({ error: "Event access required." }, { status: 403 });
  if (!isSeasonRegistrationOpen(season)) {
    return Response.json({ proposals: [], candidates: [], canPropose: false, canReview: authz.isAdmin, closed: true });
  }

  const callerMembership = await prisma.seasonMembership.findUnique({
    where: { seasonId_userId: { seasonId: season.id, userId: session.user.id } },
    include: { eventPlayer: { select: { id: true, eventId: true } } },
  });
  const isParticipant = callerMembership?.status === "active" && callerMembership.eventPlayer.eventId === season.eventId;
  if (!isParticipant && !authz.isAdmin) {
    return Response.json({ proposals: [], candidates: [], canPropose: false, canReview: false });
  }

  const [proposals, candidates, assignedMemberships, seasonMemberships, eventPlayers] = await Promise.all([
    prisma.crewProposal.findMany({
      where: authz.isAdmin ? { seasonId: season.id } : { seasonId: season.id, proposerMembershipId: callerMembership?.id },
      include: proposalInclude,
      orderBy: { createdAt: "desc" },
    }),
    prisma.seasonMembership.findMany({
      where: { seasonId: season.id, status: "active", crewId: null, eventPlayer: { eventId: season.eventId } },
      include: { eventPlayer: { select: { id: true, name: true, userId: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.seasonMembership.findMany({
      where: { seasonId: season.id, status: "active", crewId: { not: null } },
      select: { userId: true },
    }),
    prisma.seasonMembership.findMany({
      where: { seasonId: season.id, eventPlayer: { eventId: season.eventId } },
      select: { userId: true, status: true },
    }),
    prisma.eventPlayer.findMany({
      where: { eventId: season.eventId, userId: { not: null } },
      select: { userId: true, name: true, gamesPlayed: true },
      orderBy: { gamesPlayed: "desc" },
    }),
  ]);
  const assignedUserIds = new Set(assignedMemberships.map((membership) => membership.userId));
  const withdrawnUserIds = new Set(seasonMemberships.filter((membership) => membership.status === "withdrawn").map((membership) => membership.userId));
  const candidateUserIds = new Set(candidates.map((membership) => membership.eventPlayer.userId));
  const externalEventCandidates = eventPlayers
    .filter((player): player is typeof player & { userId: string } => !!player.userId && !assignedUserIds.has(player.userId) && !withdrawnUserIds.has(player.userId) && !candidateUserIds.has(player.userId))
    .map((player) => ({ userId: player.userId, name: player.name, gamesPlayed: player.gamesPlayed }));

  return Response.json({
    proposals: proposals.map(serializeProposal),
    candidates: [
      ...candidates.map((membership) => ({ membershipId: membership.id, eventPlayerId: membership.eventPlayer.id, userId: membership.eventPlayer.userId, name: membership.eventPlayer.name })),
      ...externalEventCandidates,
    ],
    excludedUserIds: assignedMemberships.map((membership) => membership.userId),
    proposerMembershipId: isParticipant ? callerMembership?.id : null,
    canPropose: isParticipant,
    canReview: authz.isAdmin,
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const season = await getSeasonForEvent(params.seasonId ?? "", params.id ?? "");
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });

  let body: { action?: unknown; email?: unknown; token?: unknown; name?: unknown; members?: unknown; membershipIds?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    body = parsed as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (body.action === "claim-invite") {
    if (!isSeasonRegistrationOpen(season)) return Response.json({ error: "Season registration is closed." }, { status: 409 });
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return Response.json({ error: "Invitation token is required." }, { status: 400 });
    try {
      const membership = await claimInvite(season, session.user.id, token);
      return Response.json({ membership }, { status: 200 });
    } catch (error) {
      if (error instanceof ProposalInputError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }

  const authz = await authorizeSeasonRequest(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });
  if (!isSeasonRegistrationOpen(season)) return Response.json({ error: "Season registration is closed." }, { status: 409 });

  const proposerMembership = await prisma.seasonMembership.findUnique({
    where: { seasonId_userId: { seasonId: season.id, userId: session.user.id } },
    include: { eventPlayer: { select: { id: true, eventId: true } } },
  });
  if (!proposerMembership || proposerMembership.status !== "active" || proposerMembership.eventPlayer.eventId !== season.eventId) {
    return Response.json({ error: "Only active Season participants can propose a Crew." }, { status: 403 });
  }

  if (body.action === "invite") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (existingUser) {
      const eventPlayerInEvent = await prisma.eventPlayer.findFirst({ where: { eventId: season.eventId, userId: existingUser.id } });
      const playedTogether = eventPlayerInEvent ? true : await prisma.gameParticipant.findFirst({
        where: {
          eventPlayer: { userId: existingUser.id },
          status: "active",
          archivedAt: null,
          game: { participants: { some: { eventPlayer: { userId: session.user.id }, status: "active", archivedAt: null } } },
        },
        select: { id: true },
      });
      if (!playedTogether) return Response.json({ error: "Choose a player from this Event or someone you have played with." }, { status: 403 });
      const existingMembership = await prisma.seasonMembership.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId: existingUser.id } } });
      if (existingMembership?.status === "withdrawn") return Response.json({ error: "This person has withdrawn from the Season and must rejoin before being proposed." }, { status: 409 });
      if (existingMembership?.crewId) return Response.json({ error: "This person is already assigned to a Crew." }, { status: 409 });
      return Response.json({ invited: false, registered: true, candidate: {
        membershipId: existingMembership?.id,
        eventPlayerId: eventPlayerInEvent?.id,
        userId: existingUser.id,
        name: existingUser.name,
      } });
    }
    const event = await prisma.event.findUnique({ where: { id: season.eventId }, select: { title: true, dateTime: true, location: true } });
    if (!event) return Response.json({ error: "Event not found." }, { status: 404 });
    const existingInvite = await prisma.crewProposalInvite.findFirst({ where: { seasonId: season.id, email, status: "pending" }, select: { id: true, token: true } });
    const invite = existingInvite ?? await prisma.crewProposalInvite.create({
      data: { seasonId: season.id, invitedByUserId: session.user.id, email, token: crypto.randomUUID() },
      select: { id: true, token: true },
    });
    const origin = `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev"}`;
    try {
      await sendPlayerInviteToRegister(email, {
        eventTitle: event.title,
        dateTime: event.dateTime.toISOString(),
        location: event.location,
        eventUrl: `${origin}/events/${season.eventId}/seasons/${season.id}?crewInviteToken=${encodeURIComponent(invite.token)}`,
        inviterName: session.user.name ?? null,
      });
    } catch {
      if (!existingInvite) await prisma.crewProposalInvite.delete({ where: { id: invite.id } });
      return Response.json({ error: "The invitation could not be sent." }, { status: 502 });
    }
    return Response.json({ invited: true, email, token: invite.token }, { status: 202 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 50) return Response.json({ error: "Crew names must be between 1 and 50 characters." }, { status: 400 });
  const memberInputs = parseMemberInputs(body);
  if (!memberInputs) return Response.json({ error: "members must be an array." }, { status: 400 });
  if (memberInputs.length < 3 || memberInputs.length > 5) return Response.json({ error: "Each Crew must contain between 3 and 5 participants." }, { status: 400 });

  try {
    const proposal = await prisma.$transaction(async (tx) => {
      const membershipIds = await resolveProposalMemberships(tx, season.eventId, season.id, session.user.id, memberInputs);
      if (new Set(membershipIds).size !== membershipIds.length) throw new ProposalInputError(400, "A participant cannot be selected more than once.");
      if (!membershipIds.includes(proposerMembership.id)) throw new ProposalInputError(400, "The proposer must be included in the Crew.");

      const selectedMemberships = await tx.seasonMembership.findMany({
        where: { id: { in: membershipIds }, seasonId: season.id, status: "active", eventPlayer: { eventId: season.eventId } },
        select: { id: true, crewId: true },
      });
      if (selectedMemberships.length !== membershipIds.length) throw new ProposalInputError(400, "Only active Season participants from this Event can be selected.");
      if (selectedMemberships.some((membership) => membership.crewId)) throw new ProposalInputError(409, "Participants already assigned to a Crew cannot be proposed.");

      const [existingCrews, existingProposal, overlappingProposal] = await Promise.all([
        tx.crew.findMany({ where: { seasonId: season.id }, select: { id: true, name: true } }),
        tx.crewProposal.findFirst({ where: { seasonId: season.id, proposerMembershipId: proposerMembership.id, status: "pending" }, select: { id: true } }),
        tx.crewProposalMember.findFirst({ where: { seasonMembershipId: { in: membershipIds }, proposal: { seasonId: season.id, status: "pending" } }, select: { id: true } }),
      ]);
      if (existingCrews.some((crew) => crew.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new ProposalInputError(409, "A Crew with this name already exists.");
      if (existingProposal) throw new ProposalInputError(409, "You already have a pending Crew proposal.");
      if (overlappingProposal) throw new ProposalInputError(409, "One or more participants are already in a pending Crew proposal.");

      return tx.crewProposal.create({
        data: { seasonId: season.id, proposerMembershipId: proposerMembership.id, name, members: { create: membershipIds.map((seasonMembershipId) => ({ seasonMembershipId })) } },
        include: proposalInclude,
      });
    });
    return Response.json({ proposal: serializeProposal(proposal) }, { status: 201 });
  } catch (error) {
    if (error instanceof ProposalInputError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "A Crew proposal member already exists." }, { status: 409 });
    throw error;
  }
};
