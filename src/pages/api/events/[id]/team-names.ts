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

  // The stored lineups carry their own labels: the balanced rebalance keys its
  // draw by Event labels and writes members back by TeamResult name, so a
  // rename that touches only the Event makes that lookup miss — after the
  // deleteMany, both lineups come back empty. Rows are created team-one-first
  // (the same convention GET /teams reads `teamResults[0]` as team one), so
  // position — not the old label — is the identity the rename maps by.
  const teamRows = await prisma.teamResult.findMany({ where: { eventId }, select: { id: true } });

  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { teamOneName: one, teamTwoName: two } }),
    ...teamRows.slice(0, 2).map((row, i) =>
      prisma.teamResult.update({ where: { id: row.id }, data: { name: i === 0 ? one : two } }),
    ),
  ]);

  return Response.json({ ok: true });
};
