import type { APIRoute } from "astro";
import { prisma, Prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getSeasonForEvent, requireSeasonAdmin, isSeasonRegistrationOpen } from "~/lib/seasonSetup.server";

interface CrewInput {
  id?: unknown;
  name?: unknown;
  membershipIds?: unknown;
}

function parseStartDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const season = await getSeasonForEvent(params.seasonId ?? "", params.id ?? "");
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  const authz = await requireSeasonAdmin(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });
  if (!authz.isAdmin) return Response.json({ error: "Only the event owner or an admin can set Crews." }, { status: 403 });
  // Admins may adjust Crews at any point in the Season lifecycle, including
  // after activation, so they can always correct mistakes.

  let body: { startsAt?: unknown; crews?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    body = parsed as { startsAt?: unknown; crews?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const startsAt = parseStartDate(body.startsAt);
  if (body.startsAt !== undefined && startsAt === undefined) {
    return Response.json({ error: "startsAt must be a valid date or null." }, { status: 400 });
  }
  if (!Array.isArray(body.crews) || body.crews.length < 2) {
    return Response.json({ error: "At least two Crews are required." }, { status: 400 });
  }

  const crews: Array<{ id: string | undefined; name: string; membershipIds: string[] }> = [];
  const names = new Set<string>();
  const submittedCrewIds = new Set<string>();
  const assignedMembershipIds = new Set<string>();
  for (const rawCrew of body.crews as CrewInput[]) {
    const name = typeof rawCrew?.name === "string" ? rawCrew.name.trim() : "";
    const membershipIds = Array.isArray(rawCrew?.membershipIds)
      ? rawCrew.membershipIds.filter((id): id is string => typeof id === "string")
      : [];
    if (Array.isArray(rawCrew?.membershipIds) && membershipIds.length !== rawCrew.membershipIds.length) {
      return Response.json({ error: "Crew membership IDs must be strings." }, { status: 400 });
    }
    const id = rawCrew?.id === undefined ? undefined : typeof rawCrew.id === "string" && rawCrew.id.trim() ? rawCrew.id : "";
    if (rawCrew?.id !== undefined && !id) return Response.json({ error: "Crew ID must be a non-empty string." }, { status: 400 });
    if (id && submittedCrewIds.has(id)) return Response.json({ error: "A Crew cannot be submitted more than once." }, { status: 400 });
    if (id) submittedCrewIds.add(id);
    if (!name || name.length > 50) return Response.json({ error: "Crew names must be between 1 and 50 characters." }, { status: 400 });
    if (names.has(name.toLocaleLowerCase())) return Response.json({ error: "Crew names must be unique within the Season." }, { status: 400 });
    if (membershipIds.length < 3 || membershipIds.length > 5) return Response.json({ error: "Each Crew must contain between 3 and 5 participants." }, { status: 400 });
    for (const membershipId of membershipIds) {
      if (assignedMembershipIds.has(membershipId)) return Response.json({ error: "A participant cannot be assigned to multiple Crews." }, { status: 400 });
      assignedMembershipIds.add(membershipId);
    }
    names.add(name.toLocaleLowerCase());
    crews.push({ id: id || undefined, name, membershipIds });
  }

  const memberships = await prisma.seasonMembership.findMany({
    where: { seasonId: season.id },
    include: { eventPlayer: { select: { id: true, eventId: true } } },
  });
  const membershipById = new Map(memberships.map((membership) => [membership.id, membership]));
  for (const membershipId of assignedMembershipIds) {
    const membership = membershipById.get(membershipId);
    if (!membership || membership.status !== "active" || membership.eventPlayer.eventId !== season.eventId) {
      return Response.json({ error: "Only active Season participants from this Event can be assigned." }, { status: 400 });
    }
  }

  const sameEventMembershipIds = memberships
    .filter((membership) => membership.eventPlayer.eventId === season.eventId)
    .map((membership) => membership.id);
  const existingCrews = await prisma.crew.findMany({ where: { seasonId: season.id }, select: { id: true, sortOrder: true } });
  const approvedProposals = await prisma.crewProposal.findMany({
    where: { seasonId: season.id, status: "approved", approvedCrewId: { not: null } },
    select: { approvedCrewId: true, members: { select: { seasonMembershipId: true } } },
  });
  const pendingProposals = await prisma.crewProposal.findMany({
    where: { seasonId: season.id, status: "pending" },
    select: { id: true, members: { select: { seasonMembershipId: true } } },
  });
  const pendingProposalMembers = pendingProposals.flatMap((proposal) => proposal.members);
  const registrationOpen = isSeasonRegistrationOpen(season);
  for (const proposal of approvedProposals) {
    const approvedCrewId = proposal.approvedCrewId;
    if (!approvedCrewId || !submittedCrewIds.has(approvedCrewId)) {
      return Response.json({ error: "Approved proposal Crews must remain in the Season setup." }, { status: 409 });
    }
    const submittedCrew = crews.find((crew) => crew.id === approvedCrewId);
    const approvedMemberIds = proposal.members.map((member) => member.seasonMembershipId);
    if (!submittedCrew || submittedCrew.membershipIds.length !== approvedMemberIds.length || !approvedMemberIds.every((id) => submittedCrew.membershipIds.includes(id))) {
      return Response.json({ error: "Approved proposal Crew memberships cannot be changed in direct setup." }, { status: 409 });
    }
  }
  if (registrationOpen && pendingProposalMembers.some((member) => assignedMembershipIds.has(member.seasonMembershipId))) {
    return Response.json({ error: "Participants in pending Crew proposals cannot be assigned until the proposal is approved or rejected." }, { status: 409 });
  }
  const existingCrewIds = new Set(existingCrews.map((crew) => crew.id));
  for (const crew of crews) {
    if (crew.id && !existingCrewIds.has(crew.id)) {
      return Response.json({ error: "Crew does not belong to this Season." }, { status: 400 });
    }
  }
  const submittedExistingCrewIds = new Set(crews.flatMap((crew) => crew.id ? [crew.id] : []));
  const protectedForeignCrewIds = new Set(
    memberships
      .filter((membership) => membership.crewId && membership.eventPlayer.eventId !== season.eventId)
      .map((membership) => membership.crewId as string),
  );
  for (const crewId of protectedForeignCrewIds) {
    if (!submittedExistingCrewIds.has(crewId)) {
      return Response.json({ error: "Crews with participants from another Event cannot be deleted." }, { status: 400 });
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (startsAt !== undefined) {
        await tx.season.update({ where: { id: season.id }, data: { startsAt } });
      }
      if (!registrationOpen && pendingProposals.length > 0) {
        await tx.crewProposal.updateMany({
          where: { seasonId: season.id, status: "pending" },
          data: {
            status: "rejected",
            rejectionReason: "Registration closed before this proposal was approved.",
            reviewedByUserId: session.user.id,
            reviewedAt: new Date(),
          },
        });
      }
      await tx.seasonMembership.updateMany({
        where: { seasonId: season.id, id: { in: sameEventMembershipIds } },
        data: { crewId: null },
      });
      for (const [index, existingCrew] of existingCrews.entries()) {
        await tx.crew.update({ where: { id: existingCrew.id }, data: { name: `__setup_${existingCrew.id}`, sortOrder: -1_000_000 - index } });
      }
      await tx.crew.deleteMany({
        where: { seasonId: season.id, ...(crews.some((crew) => crew.id) ? { id: { notIn: crews.flatMap((crew) => crew.id ? [crew.id] : []) } } : {}) },
      });

      const savedCrews: Array<{ id: string; membershipIds: string[] }> = [];
      for (const [sortOrder, crew] of crews.entries()) {
        const saved = crew.id
          ? await tx.crew.update({ where: { id: crew.id }, data: { name: crew.name, sortOrder } })
          : await tx.crew.create({ data: { seasonId: season.id, name: crew.name, sortOrder } });
        savedCrews.push({ id: saved.id, membershipIds: crew.membershipIds });
      }
      for (const savedCrew of savedCrews) {
        if (savedCrew.membershipIds.length > 0) {
          await tx.seasonMembership.updateMany({
            where: { seasonId: season.id, id: { in: savedCrew.membershipIds } },
            data: { crewId: savedCrew.id },
          });
        }
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "Crew names must be unique within the Season." }, { status: 409 });
    }
    throw error;
  }

  return Response.json({ saved: true, seasonId: season.id });
};
