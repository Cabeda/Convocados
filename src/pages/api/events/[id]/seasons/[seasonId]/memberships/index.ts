import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getSeasonForEvent, requireSeasonAdmin } from "~/lib/seasonSetup.server";

/**
 * Enroll a single EventPlayer into a Season (admin-only), optionally straight
 * into a Crew. Backs the "add player" autocomplete in the setup UI for
 * players who never joined on their own. Withdrawn members are reactivated.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const season = await getSeasonForEvent(params.seasonId ?? "", params.id ?? "");
  if (!season) return Response.json({ error: "Season not found." }, { status: 404 });
  const authz = await requireSeasonAdmin(season, session, request);
  if (!authz.allowed) return Response.json({ error: "Event access required." }, { status: 403 });
  if (!authz.isAdmin) return Response.json({ error: "Only the event owner or an admin can manage a Season." }, { status: 403 });

  let body: { eventPlayerId?: unknown; crewId?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    body = parsed as { eventPlayerId?: unknown; crewId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (typeof body.eventPlayerId !== "string" || !body.eventPlayerId.trim()) {
    return Response.json({ error: "eventPlayerId is required." }, { status: 400 });
  }

  const eventPlayer = await prisma.eventPlayer.findFirst({
    where: { id: body.eventPlayerId, eventId: season.eventId },
    select: { id: true, name: true, userId: true },
  });
  if (!eventPlayer) return Response.json({ error: "Event player not found." }, { status: 404 });

  let crewId: string | null = null;
  if (body.crewId !== undefined && body.crewId !== null) {
    if (typeof body.crewId !== "string" || !body.crewId.trim()) {
      return Response.json({ error: "crewId must be a non-empty string." }, { status: 400 });
    }
    const crew = await prisma.crew.findFirst({ where: { id: body.crewId, seasonId: season.id }, select: { id: true } });
    if (!crew) return Response.json({ error: "Crew not found." }, { status: 404 });
    crewId = crew.id;
  }

  if (!eventPlayer.userId || !(await prisma.user.findUnique({ where: { id: eventPlayer.userId }, select: { id: true } }))) {
    return Response.json({ error: "Player has no account yet." }, { status: 422 });
  }

  const existingByPlayer = await prisma.seasonMembership.findFirst({
    where: { seasonId: season.id, eventPlayerId: eventPlayer.id },
  });
  const existingByUser = await prisma.seasonMembership.findUnique({
    where: { seasonId_userId: { seasonId: season.id, userId: eventPlayer.userId } },
  });
  const existing = existingByPlayer ?? existingByUser;
  if (existing?.status === "active") {
    return Response.json({ error: "This player is already a season member." }, { status: 409 });
  }
  if (existing) {
    const reactivated = await prisma.seasonMembership.update({
      where: { id: existing.id },
      data: { status: "active", withdrawnAt: null, crewId },
    });
    return Response.json({ membership: reactivated });
  }

  const membership = await prisma.seasonMembership.create({
    data: { seasonId: season.id, eventPlayerId: eventPlayer.id, userId: eventPlayer.userId, crewId },
  });
  return Response.json({ membership }, { status: 201 });
};
