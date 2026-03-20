import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { declineSpot } from "../../../../../lib/priority.server";

/** POST — player declines their priority spot */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, dateTime: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const result = await declineSpot(event.id, session.user.id, event.dateTime);
  if (!result) return Response.json({ error: "No pending confirmation found." }, { status: 404 });

  return Response.json({ ok: true, status: result.status });
};
