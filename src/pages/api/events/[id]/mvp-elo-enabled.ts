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
  const mvpEloEnabled = Boolean(body.mvpEloEnabled);

  if (mvpEloEnabled && !event.mvpEnabled) {
    return Response.json(
      { error: "MVP voting must be enabled before enabling the MVP ELO bonus." },
      { status: 400 },
    );
  }

  await prisma.event.update({
    where: { id: params.id },
    data: { mvpEloEnabled },
  });

  return Response.json({ mvpEloEnabled });
};
