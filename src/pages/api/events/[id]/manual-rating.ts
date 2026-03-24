import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../lib/eventLog.server";

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin, session } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const allowManualRating = Boolean(body.allowManualRating);

  await prisma.event.update({
    where: { id: params.id },
    data: { allowManualRating },
  });

  const actorName = session?.user?.name ?? null;
  const actorId = session?.user?.id ?? null;
  logEvent(
    params.id!,
    allowManualRating ? "rating_manual_enabled" : "rating_manual_disabled",
    actorName,
    actorId,
  );


  return Response.json({ allowManualRating });
};
