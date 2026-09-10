import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getSeasonForEvent, requireSeasonAdmin } from "~/lib/seasonSetup.server";

/**
 * Delete a Crew completely (admin-only). Members are unassigned from the Crew
 * but stay in the Season as free agents. Crews that back an approved proposal
 * or hold cross-event legacy members are protected, mirroring the setup save
 * endpoint.
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
  if (!authz.isAdmin) return Response.json({ error: "Only the event owner or an admin can delete Crews." }, { status: 403 });

  const crewId = params.crewId ?? "";
  const crew = await prisma.crew.findFirst({ where: { id: crewId, seasonId: season.id }, select: { id: true } });
  if (!crew) return Response.json({ error: "Crew not found." }, { status: 404 });

  const approvedProposal = await prisma.crewProposal.findFirst({
    where: { seasonId: season.id, status: "approved", approvedCrewId: crew.id },
    select: { id: true },
  });
  if (approvedProposal) {
    return Response.json({ error: "A Crew created from an approved proposal cannot be deleted." }, { status: 409 });
  }

  const memberships = await prisma.seasonMembership.findMany({
    where: { seasonId: season.id, crewId: crew.id },
    select: { id: true, eventPlayer: { select: { eventId: true } } },
  });
  const hasForeignMember = memberships.some((membership) => membership.eventPlayer.eventId !== season.eventId);
  if (hasForeignMember) {
    return Response.json({ error: "Crews with participants from another Event cannot be deleted." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.seasonMembership.updateMany({
      where: { seasonId: season.id, crewId: crew.id },
      data: { crewId: null },
    });
    await tx.crew.delete({ where: { id: crew.id } });
  });

  return Response.json({ ok: true });
};
