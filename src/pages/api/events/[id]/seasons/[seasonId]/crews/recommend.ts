import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { recommendCrews } from "~/lib/crewRecommendation";
import { getSeasonForEvent, requireSeasonAdmin, seasonAttendanceWindow } from "~/lib/seasonSetup.server";

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
  // Admins may re-run recommendations at any point in the lifecycle.

  let body: { crewCount?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    body = parsed as { crewCount?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const crewCount = typeof body.crewCount === "number" ? body.crewCount : Number(body.crewCount);
  if (!Number.isInteger(crewCount) || crewCount < 2) {
    return Response.json({ error: "crewCount must be an integer of at least 2." }, { status: 400 });
  }

  const memberships = await prisma.seasonMembership.findMany({
    where: { seasonId: season.id, status: "active", eventPlayer: { eventId: season.eventId } },
    include: { eventPlayer: { select: { id: true, name: true, userId: true, rating: true } } },
    orderBy: { joinedAt: "asc" },
  });
  const ratings = await prisma.playerRating.findMany({
    where: { eventId: season.eventId },
    select: { userId: true, name: true, rating: true },
  });
  const ratingByUserId = new Map(ratings.flatMap((rating) => rating.userId ? [[rating.userId, rating.rating] as const] : []));
  const ratingByName = new Map(ratings.map((rating) => [rating.name, rating.rating]));
  const ratingFor = (membership: (typeof memberships)[number]) =>
    ratingByUserId.get(membership.eventPlayer.userId ?? membership.userId)
      ?? ratingByName.get(membership.eventPlayer.name)
      ?? membership.eventPlayer.rating;

  // ── History for smarter recommendations (GH-917) ──────────────────────────
  // gamesPlayed: attended (active) game slots in the season period so far.
  // previousCrewId: the Crew the player belonged to in the most recent
  // non-cancelled previous Season of this event, when the membership was
  // still active there.
  const attendanceWindow = seasonAttendanceWindow(season);
  const [participants, previousSeason] = await Promise.all([
    prisma.gameParticipant.findMany({
      where: {
        eventPlayer: { eventId: season.eventId },
        status: "active",
        game: { eventId: season.eventId, dateTime: { gte: attendanceWindow.gte, lte: attendanceWindow.lte }, status: { not: "cancelled" } },
      },
      select: { eventPlayerId: true },
    }),
    prisma.season.findFirst({
      where: { eventId: season.eventId, id: { not: season.id }, status: { in: ["active", "review", "completed"] } },
      orderBy: { registrationOpensAt: "desc" },
      select: { id: true },
    }),
  ]);
  const gamesPlayedByEventPlayer = new Map<string, number>();
  for (const participant of participants) {
    gamesPlayedByEventPlayer.set(participant.eventPlayerId, (gamesPlayedByEventPlayer.get(participant.eventPlayerId) ?? 0) + 1);
  }
  let previousCrewByEventPlayer = new Map<string, string>();
  if (previousSeason) {
    const previousMemberships = await prisma.seasonMembership.findMany({
      where: { seasonId: previousSeason.id, status: "active", crewId: { not: null } },
      select: { eventPlayerId: true, crewId: true },
    });
    previousCrewByEventPlayer = new Map(previousMemberships.map((membership) => [membership.eventPlayerId, membership.crewId as string]));
  }

  const recommendation = recommendCrews(
    memberships.map((membership) => ({
      membershipId: membership.id,
      name: membership.eventPlayer.name,
      rating: ratingFor(membership),
      gamesPlayed: gamesPlayedByEventPlayer.get(membership.eventPlayer.id) ?? 0,
      previousCrewId: previousCrewByEventPlayer.get(membership.eventPlayer.id) ?? null,
    })),
    crewCount,
  );
  if (recommendation.errors.length > 0) {
    return Response.json({ error: recommendation.errors[0], errors: recommendation.errors }, { status: 422 });
  }

  const membersById = new Map(memberships.map((membership) => [membership.id, membership]));
  return Response.json({
    crews: recommendation.crews.map((crew) => ({
      ...crew,
      members: crew.membershipIds.flatMap((membershipId) => {
        const membership = membersById.get(membershipId);
        return membership ? [{
          membershipId,
          eventPlayerId: membership.eventPlayer.id,
          name: membership.eventPlayer.name,
          rating: ratingFor(membership),
        }] : [];
      }),
    })),
  });
};
