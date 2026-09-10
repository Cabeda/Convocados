import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getSeasonForEvent, requireSeasonAdmin } from "~/lib/seasonSetup.server";

/**
 * Remove a Season member (admin-only). Withdraws the membership instead of
 * deleting it, so past leaderboard results keep attributing to the player
 * while future games exclude them. Re-adding is possible through the enroll
 * endpoints, which reactivate withdrawn memberships.
 */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const season = await getSeasonForEvent(params.seasonId ?? "", params.id ?? "");
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  const authz = await requireSeasonAdmin(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });
  if (!authz.isAdmin) return Response.json({ error: "Only the event owner or an admin can manage a Season." }, { status: 403 });

  const membership = await prisma.seasonMembership.findFirst({
    where: { id: params.membershipId ?? "", seasonId: season.id },
  });
  if (!membership) return Response.json({ error: "Membership not found." }, { status: 404 });
  if (membership.status === "withdrawn") return Response.json({ membership });

  const withdrawn = await prisma.seasonMembership.update({
    where: { id: membership.id },
    data: { status: "withdrawn", withdrawnAt: new Date() },
  });
  return Response.json({ membership: withdrawn });
};
