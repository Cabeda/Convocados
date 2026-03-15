import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";

/** DELETE — unsubscribe a webhook */
export const DELETE: APIRoute = async ({ params }) => {
  const eventId = params.id!;
  const webhookId = params.webhookId!;

  const webhook = await prisma.webhookSubscription.findFirst({
    where: { id: webhookId, eventId },
  });
  if (!webhook) return Response.json({ error: "Not found." }, { status: 404 });

  await prisma.webhookSubscription.delete({ where: { id: webhookId } });

  return Response.json({ ok: true });
};
