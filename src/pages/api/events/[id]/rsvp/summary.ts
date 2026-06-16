import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getRsvpSummary } from "~/lib/rsvp.server";

/** GET /api/events/[id]/rsvp/summary — Owner/Admin only. */
export const GET: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true, isAdmin: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const { isOwner } = await checkOwnership(request, event.ownerId, session);
  const isAdmin = !!event.isAdmin;
  if (!isOwner && !isAdmin && event.ownerId !== session?.user?.id) {
    // Admins on the event (not platform admins) — query EventAdmin table
    if (session?.user) {
      const admin = await prisma.eventAdmin.findUnique({
        where: { eventId_userId: { eventId, userId: session.user.id } },
        select: { id: true },
      });
      if (!admin) return Response.json({ error: "Forbidden." }, { status: 403 });
    } else {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  const summary = await getRsvpSummary(eventId);
  return Response.json(summary);
};
