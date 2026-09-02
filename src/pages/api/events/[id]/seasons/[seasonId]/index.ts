import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { authorizeSeasonRequest, getSeasonForEvent, requireSeasonAdmin } from "~/lib/seasonSetup.server";

export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const seasonId = params.seasonId ?? "";
  const season = await getSeasonForEvent(seasonId, eventId);
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });

  const session = await getSession(request);
  let authz = await authorizeSeasonRequest(season, session, request);
  const inviteToken = new URL(request.url).searchParams.get("crewInviteToken")?.trim();
  if (!authz.allowed && inviteToken && session?.user) {
    const invite = await prisma.crewProposalInvite.findUnique({ where: { token: inviteToken }, select: { seasonId: true, email: true, status: true, claimedByUserId: true } });
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } });
    const tokenAccess = invite?.seasonId === season.id && user && (
      (invite.status === "pending" && user.email.toLowerCase() === invite.email)
      || (invite.status === "claimed" && invite.claimedByUserId === session.user.id)
    );
    if (tokenAccess) authz = { ...authz, allowed: true };
  }
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });

  const [memberships, crews, viewerMembership, viewerEventPlayer] = await Promise.all([
    prisma.seasonMembership.findMany({
      where: { seasonId, status: "active", eventPlayer: { eventId } },
      include: { eventPlayer: { select: { id: true, name: true, userId: true, rating: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.crew.findMany({
      where: { seasonId },
      include: {
        memberships: {
          where: { status: "active", eventPlayer: { eventId } },
          include: { eventPlayer: { select: { id: true, name: true, userId: true, rating: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
    session?.user ? prisma.seasonMembership.findUnique({
      where: { seasonId_userId: { seasonId, userId: session.user.id } },
      select: { id: true, status: true, eventPlayerId: true },
    }) : Promise.resolve(null),
    session?.user ? prisma.eventPlayer.findFirst({
      where: { eventId, userId: session.user.id },
      select: { id: true },
    }) : Promise.resolve(null),
  ]);

  const ratings = authz.isAdmin
    ? await prisma.playerRating.findMany({ where: { eventId }, select: { userId: true, name: true, rating: true } })
    : [];
  const ratingByUserId = new Map(ratings.flatMap((rating) => rating.userId ? [[rating.userId, rating.rating] as const] : []));
  const ratingByName = new Map(ratings.map((rating) => [rating.name, rating.rating]));
  const ratingFor = (membership: (typeof memberships)[number]) =>
    ratingByUserId.get(membership.eventPlayer.userId ?? membership.userId)
      ?? ratingByName.get(membership.eventPlayer.name)
      ?? membership.eventPlayer.rating;

  const publicCrews = crews.map((crew) => ({
    name: crew.name,
    sortOrder: crew.sortOrder,
    members: crew.memberships.map((membership) => ({ name: membership.eventPlayer.name })),
  }));

  const result: Record<string, unknown> = {
    id: season.id,
    eventId: season.eventId,
    name: season.name,
    status: season.status,
    registrationOpensAt: season.registrationOpensAt,
    registrationClosesAt: season.registrationClosesAt,
    registrationOpen: season.status === "registration" && season.registrationOpensAt <= new Date() && new Date() < season.registrationClosesAt,
    startsAt: season.startsAt,
    activatedAt: season.activatedAt,
    crews: publicCrews,
    viewerEventPlayerId: viewerEventPlayer?.id ?? null,
    viewerMembership: viewerMembership ? {
      id: viewerMembership.id,
      status: viewerMembership.status,
      eventPlayerId: viewerMembership.eventPlayerId,
    } : null,
  };

  if (authz.isAdmin) {
    result.crews = crews.map((crew) => ({
      id: crew.id,
      name: crew.name,
      sortOrder: crew.sortOrder,
      members: crew.memberships.map((membership) => ({
        membershipId: membership.id,
        eventPlayerId: membership.eventPlayer.id,
        name: membership.eventPlayer.name,
        rating: ratingFor(membership),
      })),
    }));
    result.activeMembers = memberships.map((membership) => ({
      membershipId: membership.id,
      eventPlayerId: membership.eventPlayer.id,
      name: membership.eventPlayer.name,
      rating: ratingFor(membership),
      crewId: membership.crewId,
    }));
  }

  return Response.json({ season: result });
};

const MIN_CREWS = 3;
const MIN_PARTICIPANTS = 9;
const MIN_CREW_SIZE = 3;
const MAX_CREW_SIZE = 5;

/**
 * Activate a Season (registration → active). Admin-only. Enforces the pilot
 * gate — at least three qualifying Crews (3–5 confirmed members) and at least
 * nine participants — then locks registration and crew membership. Crews that
 * do not reach three members do not qualify: their members become free agents
 * whose opt-ins expire (spec: friendly-competition-pilot.md).
 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const eventId = params.id ?? "";
  const seasonId = params.seasonId ?? "";
  const season = await getSeasonForEvent(seasonId, eventId);
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });

  const authz = await requireSeasonAdmin(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });
  if (!authz.isAdmin) return Response.json({ error: "Only the event owner or an admin can manage a Season." }, { status: 403 });

  let body: { action?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    body = parsed as { action?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (body.action !== "activate") {
    return Response.json({ error: "Unsupported action." }, { status: 400 });
  }
  if (season.status !== "registration") {
    return Response.json({ error: "Only a Season in registration can be started." }, { status: 409 });
  }

  const crews = await prisma.crew.findMany({
    where: { seasonId },
    select: {
      id: true,
      _count: { select: { memberships: { where: { status: "active", eventPlayer: { eventId } } } } },
    },
  });
  const participantCount = await prisma.seasonMembership.count({
    where: { seasonId, status: "active", eventPlayer: { eventId } },
  });

  const qualifyingCrews = crews.filter((crew) => crew._count.memberships >= MIN_CREW_SIZE && crew._count.memberships <= MAX_CREW_SIZE);
  const oversizedCrew = crews.find((crew) => crew._count.memberships > MAX_CREW_SIZE);
  if (oversizedCrew) {
    return Response.json({ error: `A Crew cannot have more than ${MAX_CREW_SIZE} members.` }, { status: 409 });
  }
  if (qualifyingCrews.length < MIN_CREWS || participantCount < MIN_PARTICIPANTS) {
    return Response.json({
      error: `Starting the Season needs at least ${MIN_CREWS} Crews of ${MIN_CREW_SIZE}–${MAX_CREW_SIZE} and ${MIN_PARTICIPANTS} participants.`,
      requirements: { minCrews: MIN_CREWS, minParticipants: MIN_PARTICIPANTS, qualifyingCrews: qualifyingCrews.length, participants: participantCount },
    }, { status: 409 });
  }

  const qualifyingIds = new Set(qualifyingCrews.map((crew) => crew.id));
  const nonQualifyingCrewIds = crews.filter((crew) => !qualifyingIds.has(crew.id)).map((crew) => crew.id);

  const updated = await prisma.$transaction(async (tx) => {
    // Non-qualifying Crews dissolve: members become free agents and their
    // opt-ins expire (withdrawn); the empty Crews are removed.
    if (nonQualifyingCrewIds.length > 0) {
      await tx.seasonMembership.updateMany({
        where: { seasonId, crewId: { in: nonQualifyingCrewIds } },
        data: { crewId: null, status: "withdrawn", withdrawnAt: new Date() },
      });
      await tx.crew.deleteMany({ where: { id: { in: nonQualifyingCrewIds } } });
    }
    // Remaining free agents (no Crew) never joined a Crew — their opt-in
    // expires when registration closes.
    await tx.seasonMembership.updateMany({
      where: { seasonId, status: "active", crewId: null },
      data: { status: "withdrawn", withdrawnAt: new Date() },
    });
    return tx.season.update({
      where: { id: seasonId },
      data: { status: "active", activatedAt: new Date() },
    });
  });

  return Response.json({ season: { id: updated.id, status: updated.status, activatedAt: updated.activatedAt } });
};
