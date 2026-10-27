import { Prisma } from "~/lib/db.server";

/**
 * The one shape both crew-proposal routes read, so a payload change is made once
 * (#1442 replaced two copies that had already drifted).
 */
export const proposalInclude = {
  proposerMembership: { include: { eventPlayer: { select: { name: true } } } },
  proposedByUser: { select: { name: true } },
  targetCrew: { select: { name: true } },
  members: {
    orderBy: { id: "asc" as const },
    include: { seasonMembership: { include: { eventPlayer: { select: { name: true } } } } },
  },
} as const;

/**
 * A captain nomination carries no proposer membership: the owner named it, and
 * the nominee accepts it — everyone else sees it as a pending proposal.
 */
export function isCaptainNomination(proposal: { proposerMembershipId: string | null }) {
  return proposal.proposerMembershipId === null;
}

export function serializeProposal(
  proposal: Prisma.CrewProposalGetPayload<{ include: typeof proposalInclude }>,
  viewerMembershipId?: string | null,
) {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    kind: proposal.kind,
    targetCrewId: proposal.targetCrewId,
    targetCrewName: proposal.targetCrew?.name ?? null,
    proposerName: proposal.proposerMembership?.eventPlayer.name ?? proposal.proposedByUser?.name ?? "",
    memberNames: proposal.members.map((member) => member.seasonMembership.eventPlayer.name),
    captainNomination: isCaptainNomination(proposal),
    awaitingMyAcceptance:
      isCaptainNomination(proposal)
      && proposal.status === "pending"
      && proposal.members.some((member) => member.seasonMembershipId === viewerMembershipId),
    rejectionReason: proposal.rejectionReason,
    approvedCrewId: proposal.approvedCrewId,
    createdAt: proposal.createdAt,
    reviewedAt: proposal.reviewedAt,
  };
}
