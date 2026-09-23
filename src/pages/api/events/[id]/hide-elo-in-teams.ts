import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";

import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const hideEloInTeams = Boolean(body.hideEloInTeams);

  await prisma.event.update({
    where: { id: params.id },
    data: { hideEloInTeams },
  });

  return Response.json({ hideEloInTeams });
};
