import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { sseManager } from "../../../../lib/sse.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const eloEnabled = Boolean(body.eloEnabled);

  // When disabling ELO, also disable balanced teams
  const data: { eloEnabled: boolean; balanced?: boolean } = { eloEnabled };
  if (!eloEnabled) data.balanced = false;

  await prisma.event.update({
    where: { id: params.id },
    data,
  });

  sseManager.broadcast(params.id!, "update", { action: "elo_updated" });

  return Response.json({ eloEnabled });
};
