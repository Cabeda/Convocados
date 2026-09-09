import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { recommendCrews } from "~/lib/crewRecommendation";
import { getSeasonForEvent, requireSeasonAdmin } from "~/lib/seasonSetup.server";

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
  const recommendation = recommendCrews(
    memberships.map((membership) => ({
      membershipId: membership.id,
      name: membership.eventPlayer.name,
      rating: ratingFor(membership),
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
