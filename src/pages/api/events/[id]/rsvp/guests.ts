import type { APIRoute } from "astro";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getGuestRsvpMap } from "~/lib/rsvp.server";
import { prisma } from "~/lib/db.server";

/** GET /api/events/[id]/rsvp/guests — public. Returns the RSVP status of every active guest Player in the event. */
export const GET: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const guests = await getGuestRsvpMap(eventId);
  return Response.json({ guests });
};
