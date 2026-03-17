import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { checkOwnership } from "../../../../../lib/auth.helpers";

/** DELETE — unsubscribe a webhook */
export const DELETE: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const webhookId = params.webhookId!;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner } = await checkOwnership(request, event.ownerId);
  if (event.ownerId && !isOwner) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const webhook = await prisma.webhookSubscription.findFirst({
    where: { id: webhookId, eventId },
  });
  if (!webhook) return Response.json({ error: "Not found." }, { status: 404 });

  await prisma.webhookSubscription.delete({ where: { id: webhookId } });

  return Response.json({ ok: true });
};
