import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers";

/** POST — claim ownership of an ownerless event */
export const POST: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  if (event.ownerId) {
    return Response.json({ error: "This event already has an owner." }, { status: 409 });
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { ownerId: session.user.id },
  });

  return Response.json({ ok: true, ownerId: session.user.id });
};

/** DELETE — relinquish ownership (owner only), event becomes ownerless */
export const DELETE: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  if (event.ownerId !== session.user.id) {
    return Response.json({ error: "Only the event owner can relinquish ownership." }, { status: 403 });
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { ownerId: null },
  });

  return Response.json({ ok: true, ownerId: null });
};
