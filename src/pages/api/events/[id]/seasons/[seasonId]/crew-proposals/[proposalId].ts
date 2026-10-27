import type { APIRoute } from "astro";
import { prisma, Prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getSeasonForEvent, requireSeasonAdmin, isSeasonRegistrationOpen } from "~/lib/seasonSetup.server";
import { isCaptainNomination, proposalInclude, serializeProposal } from "~/lib/crewProposals.server";

class ProposalDecisionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** A crew is 3–5 people; approving an add must not push it over. */
const MAX_CREW_SIZE = 5;

export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const season = await getSeasonForEvent(params.seasonId ?? "", params.id ?? "");
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  const authz = await requireSeasonAdmin(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });

  let body: { decision?: unknown; rejectionReason?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    body = parsed as { decision?: unknown; rejectionReason?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (body.decision !== "approve" && body.decision !== "reject" && body.decision !== "accept") {
    return Response.json({ error: "decision must be approve, reject or accept." }, { status: 400 });
  }
  // Accepting a captain nomination is the nominee's act, not a review.
  if (body.decision !== "accept" && !authz.isAdmin) return Response.json({ error: "Only the event owner or an admin can review Crew proposals." }, { status: 403 });
  if (!isSeasonRegistrationOpen(season)) return Response.json({ error: "Crew proposals are closed for this Season." }, { status: 409 });

  const hasInvalidReason = body.rejectionReason !== undefined && body.rejectionReason !== null && typeof body.rejectionReason !== "string";
  if (hasInvalidReason) return Response.json({ error: "Rejection reason must be text." }, { status: 400 });
  const rejectionReason = typeof body.rejectionReason === "string" ? body.rejectionReason.trim() || null : null;
  if (body.decision === "reject" && rejectionReason && rejectionReason.length > 500) {
    return Response.json({ error: "Rejection reasons must be 500 characters or fewer." }, { status: 400 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const proposal = await tx.crewProposal.findUnique({
        where: { id: params.proposalId ?? "" },
        include: proposalInclude,
      });
      if (!proposal || proposal.seasonId !== season.id) throw new ProposalDecisionError(404, "Crew proposal not found.");
      if (proposal.status !== "pending") throw new ProposalDecisionError(409, "This Crew proposal has already been reviewed.");

      if (body.decision === "accept") {
        if (!isCaptainNomination(proposal)) throw new ProposalDecisionError(400, "Only a captain nomination can be accepted.");
        const nominee = proposal.members.find((member) => member.seasonMembership.userId === session.user.id);
        if (!nominee) throw new ProposalDecisionError(403, "Only the nominated captain can accept this nomination.");
        const crew = proposal.targetCrewId
          ? await tx.crew.findFirst({ where: { id: proposal.targetCrewId, seasonId: season.id }, select: { id: true } })
          : null;
        if (!crew) throw new ProposalDecisionError(409, "The Crew for this nomination no longer exists.");
        await tx.crew.update({ where: { id: crew.id }, data: { captainMembershipId: nominee.seasonMembershipId } });
        return tx.crewProposal.update({
          where: { id: proposal.id },
          data: { status: "approved", reviewedByUserId: session.user.id, reviewedAt: new Date() },
          include: proposalInclude,
        });
      }

      if (isCaptainNomination(proposal) && body.decision === "approve") {
        throw new ProposalDecisionError(409, "Only the nominated captain can accept this nomination.");
      }

      if (body.decision === "reject") {
        return tx.crewProposal.update({
          where: { id: proposal.id },
          data: { status: "rejected", rejectionReason, reviewedByUserId: session.user.id, reviewedAt: new Date() },
          include: proposalInclude,
        });
      }

      const membershipIds = proposal.members.map((member) => member.seasonMembershipId);
      if (proposal.kind !== "create") {
        const crew = proposal.targetCrewId
          ? await tx.crew.findFirst({ where: { id: proposal.targetCrewId, seasonId: season.id }, select: { id: true } })
          : null;
        if (!crew) throw new ProposalDecisionError(409, "The Crew for this proposal no longer exists.");
        if (proposal.kind === "add") {
          const memberships = await tx.seasonMembership.findMany({
            where: { id: { in: membershipIds }, seasonId: season.id, crewId: null, status: "active", eventPlayer: { eventId: season.eventId } },
            select: { id: true },
          });
          if (memberships.length !== membershipIds.length) throw new ProposalDecisionError(409, "All proposed participants must be active and unassigned.");
          const crewSize = await tx.seasonMembership.count({ where: { crewId: crew.id, status: "active" } });
          if (crewSize + membershipIds.length > MAX_CREW_SIZE) {
            throw new ProposalDecisionError(409, `A Crew cannot have more than ${MAX_CREW_SIZE} members.`);
          }
          await tx.seasonMembership.updateMany({ where: { id: { in: membershipIds } }, data: { crewId: crew.id } });
        } else if (proposal.kind === "remove") {
          const memberships = await tx.seasonMembership.findMany({
            where: { id: { in: membershipIds }, seasonId: season.id, crewId: crew.id },
            select: { id: true },
          });
          if (memberships.length !== membershipIds.length) throw new ProposalDecisionError(409, "All proposed participants must belong to this Crew.");
          await tx.seasonMembership.updateMany({ where: { id: { in: membershipIds } }, data: { crewId: null } });
        } else {
          throw new ProposalDecisionError(409, "This crew proposal kind cannot be approved.");
        }
        return tx.crewProposal.update({
          where: { id: proposal.id },
          data: { status: "approved", reviewedByUserId: session.user.id, reviewedAt: new Date() },
          include: proposalInclude,
        });
      }

      if (membershipIds.length < 3 || membershipIds.length > 5) throw new ProposalDecisionError(409, "A Crew proposal must contain between 3 and 5 participants.");
      if (!proposal.proposerMembershipId || !membershipIds.includes(proposal.proposerMembershipId)) throw new ProposalDecisionError(409, "The proposer must be included in the Crew.");

      const memberships = await tx.seasonMembership.findMany({
        where: { id: { in: membershipIds }, seasonId: season.id, status: "active", eventPlayer: { eventId: season.eventId } },
        include: { eventPlayer: { select: { eventId: true } } },
      });
      if (memberships.length !== membershipIds.length || memberships.some((membership) => membership.crewId)) {
        throw new ProposalDecisionError(409, "All proposed participants must be active and unassigned.");
      }

      const existingCrews = await tx.crew.findMany({ where: { seasonId: season.id }, select: { name: true, sortOrder: true } });
      if (existingCrews.some((crew) => crew.name.toLocaleLowerCase() === proposal.name.toLocaleLowerCase())) {
        throw new ProposalDecisionError(409, "A Crew with this name already exists.");
      }
      const sortOrder = existingCrews.reduce((max, crew) => Math.max(max, crew.sortOrder), -1) + 1;
      const crew = await tx.crew.create({ data: { seasonId: season.id, name: proposal.name, sortOrder } });
      await tx.seasonMembership.updateMany({ where: { id: { in: membershipIds }, seasonId: season.id }, data: { crewId: crew.id } });
      return tx.crewProposal.update({
        where: { id: proposal.id },
        data: { status: "approved", approvedCrewId: crew.id, reviewedByUserId: session.user.id, reviewedAt: new Date() },
        include: proposalInclude,
      });
    });
    return Response.json({ proposal: serializeProposal(updated) });
  } catch (error) {
    if (error instanceof ProposalDecisionError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A Crew with this name already exists." }, { status: 409 });
    }
    throw error;
  }
};
