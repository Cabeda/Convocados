import type { Prisma } from "~/lib/db.server";
import { prisma } from "./db.server";
import { enqueueNotification } from "./notificationQueue.server";

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

/**
 * Tell the people a captain change concerns (#1558).
 *
 * Two facts, two audiences:
 *  - a nomination reaches the nominee — always, even when they nominated
 *    themselves, because otherwise nothing tells them;
 *  - an acceptance reaches the crew's active members and the event's owner and
 *    admins, minus whoever pressed the button.
 *
 * The recipient list is computed here, at the moment of the fact, and handed to
 * the queue whole: `resolveJobAudience` resolves "who follows this event",
 * which is a different question.
 */
export async function notifyCaptainNominated(opts: {
  eventId: string;
  seasonId: string;
  crewName: string;
  nomineeUserId: string;
  nomineeName: string;
}): Promise<void> {
  await enqueueNotification(opts.eventId, "crew_captain_nominated", {
    title: opts.crewName,
    key: "captainNominatedBody",
    params: { crew: opts.crewName, name: opts.nomineeName },
    url: `/events/${opts.eventId}/seasons/${opts.seasonId}`,
    spotsLeft: 0,
    recipientUserIds: [opts.nomineeUserId],
  });
}

export async function notifyCaptainAccepted(opts: {
  eventId: string;
  seasonId: string;
  crewId: string;
  crewName: string;
  captainUserId: string;
  captainName: string;
  actorUserId: string;
}): Promise<void> {
  const [crewMembers, event, admins] = await Promise.all([
    prisma.seasonMembership.findMany({
      where: { seasonId: opts.seasonId, crewId: opts.crewId, status: "active" },
      select: { userId: true },
    }),
    prisma.event.findUnique({ where: { id: opts.eventId }, select: { ownerId: true } }),
    prisma.eventAdmin.findMany({ where: { eventId: opts.eventId }, select: { userId: true } }),
  ]);

  const recipients = new Set<string>([
    ...crewMembers.map((member: { userId: string }) => member.userId),
    ...admins.map((admin: { userId: string }) => admin.userId),
    ...(event?.ownerId ? [event.ownerId] : []),
  ]);
  recipients.delete(opts.actorUserId);

  if (recipients.size === 0) return;
  await enqueueNotification(opts.eventId, "crew_captain_accepted", {
    title: opts.crewName,
    key: "captainAcceptedBody",
    params: { crew: opts.crewName, name: opts.captainName },
    url: `/events/${opts.eventId}/seasons/${opts.seasonId}`,
    spotsLeft: 0,
    recipientUserIds: [...recipients],
  });
}
