import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { optIn } from "../../../../../lib/priority.server";

/** PUT — authenticated player opts back in to auto-enrollment */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const result = await optIn(event.id, session.user.id);
  if (result.count === 0) {
    return Response.json({ error: "You are not enrolled in priority for this event." }, { status: 404 });
  }

  return Response.json({ ok: true });
};
