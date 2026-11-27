import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { checkLinkAccess } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";

/** POST — claim ownership of an ownerless event (atomic) */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // A password-locked Event is not open by link alone: claiming it would make
  // the caller owner and bypass every other password gate. Reuse the same
  // invitee/admin/ev_access bypass as the shared link-access seam.
  if (event.accessPassword) {
    const access = await checkLinkAccess(request, event, session);
    if (!access.granted) {
      return Response.json({ error: "Password required to claim this event.", locked: true }, { status: 403 });
    }
  }

  // Atomic claim — only succeeds if ownerId is still null
  const result = await prisma.event.updateMany({
    where: { id: eventId, ownerId: null },
    data: { ownerId: session.user.id },
  });

  if (result.count === 0) {
    // Either event doesn't exist or already has an owner
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ error: "This event already has an owner." }, { status: 409 });
  }


  return Response.json({ ok: true, ownerId: session.user.id });
};

/** DELETE — relinquish ownership (owner only), event becomes ownerless */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;
  const eventId = params.id ?? "";
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
