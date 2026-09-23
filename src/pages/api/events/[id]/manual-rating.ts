import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../lib/eventLog.server";

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
  const allowManualRating = Boolean(body.allowManualRating);

  await prisma.event.update({
    where: { id: params.id },
    data: { allowManualRating },
  });

  const actorName = authz.session?.user?.name ?? null;
  const actorId = authz.session?.user?.id ?? null;
  logEvent(
    params.id ?? "",
    allowManualRating ? "rating_manual_enabled" : "rating_manual_disabled",
    actorName,
    actorId,
  );


  return Response.json({ allowManualRating });
};
