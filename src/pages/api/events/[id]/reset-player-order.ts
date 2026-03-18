import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

/** POST — reset player order to original signup order (createdAt). Owner-only. */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (!isOwner) return Response.json({ error: "Only the event owner can reset player order." }, { status: 403 });

  const players = await prisma.player.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } });

  await prisma.$transaction(
    players.map((p, i) => prisma.player.update({ where: { id: p.id }, data: { order: i } }))
  );

  return Response.json({ ok: true });
};
