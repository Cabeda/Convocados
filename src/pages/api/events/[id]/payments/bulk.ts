import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";

/** PUT — bulk mark all pending/sent payments as paid. Owner/Admin only. */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!eventCost) return Response.json({ error: "No cost set for this event." }, { status: 404 });

  const result = await prisma.playerPayment.updateMany({
    where: {
      eventCostId: eventCost.id,
      status: { in: ["pending", "sent"] },
    },
    data: { status: "paid", paidAt: new Date() },
  });

  return Response.json({ ok: true, updated: result.count });
};
