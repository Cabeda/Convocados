import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { sseManager } from "../../../../lib/sse.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (event.ownerId && !isOwner) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const { teamOneName, teamTwoName } = await request.json();

  const one = String(teamOneName ?? "").trim().slice(0, 50) || "Ninjas";
  const two = String(teamTwoName ?? "").trim().slice(0, 50) || "Gunas";

  await prisma.event.update({ where: { id: eventId }, data: { teamOneName: one, teamTwoName: two } });

  sseManager.broadcast(eventId, "update", { action: "team_names_updated" });

  return Response.json({ ok: true });
};
