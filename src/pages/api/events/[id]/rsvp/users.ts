import type { APIRoute } from "astro";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getUserRsvpMap } from "~/lib/rsvp.server";
import { getSession } from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";

/** GET /api/events/[id]/rsvp/users — logged viewers only. Returns the RSVP status of every
 *  linked User in the event (owner + followers + linked players). Anonymous viewers get an
 *  empty map — one-way privacy: logged-user RSVPs are never exposed to anon viewers. */
export const GET: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const viewerIsLogged = !!session?.user;
  const users = await getUserRsvpMap(eventId, viewerIsLogged);
  return Response.json({ users });
};
