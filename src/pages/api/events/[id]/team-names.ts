import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";

import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const { teamOneName, teamTwoName } = await request.json();

  const one = String(teamOneName ?? "").trim().slice(0, 50) || "Ninjas";
  const two = String(teamTwoName ?? "").trim().slice(0, 50) || "Gunas";

  await prisma.event.update({ where: { id: eventId }, data: { teamOneName: one, teamTwoName: two } });


  return Response.json({ ok: true });
};
