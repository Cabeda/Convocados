import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession, checkOwnership } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { upsertGuestRsvp } from "~/lib/rsvp.server";
import { isRsvpStatusValue, type RsvpStatus } from "~/lib/rsvp";
import { enqueueRsvpAnswerNotification } from "~/lib/rsvp-notifications.server";
import { archiveAndLeave } from "~/lib/leave.server";

/** POST /api/events/[id]/players/[playerId]/rsvp — owner/admin only. Body { status: "yes" | "no" | "maybe" | null }.
 *  status="no" on a guest Player also archives the player (the "leave on behalf" flow).
 *  status="yes" or status=null is a no-op on the roster. */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const playerId = params.playerId ?? "";
  if (!eventId || !playerId) {
    return Response.json({ error: "Missing event or player id." }, { status: 400 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true, dateTime: true, title: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { isOwner } = await checkOwnership(request, event.ownerId, session, eventId);
  let isAdmin = false;
  if (!isOwner) {
    const admin = await prisma.eventAdmin.findUnique({
      where: { eventId_userId: { eventId, userId: session.user.id } },
      select: { id: true },
    });
    isAdmin = !!admin;
  }
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only the owner or an admin can set guest attendance." }, { status: 403 });
  }

  if (event.dateTime.getTime() <= Date.now()) {
    return Response.json({ error: "The game has already started." }, { status: 409 });
  }

  let body: { status?: unknown } = {};
  try { body = await request.json(); } catch { /* fall through */ }
  const rawStatus = body.status;
  if (rawStatus !== null && !isRsvpStatusValue(rawStatus)) {
    return Response.json({ error: "status must be 'yes', 'no', 'maybe', or null." }, { status: 400 });
  }
  const status: RsvpStatus = rawStatus === null ? null : rawStatus;

  try {
    // 1. Write the Rsvp row (keyed on playerId, with respondedByUserId audit).
    const rsvp = await upsertGuestRsvp(eventId, playerId, status, session.user.id);

    // 2. Notify all invited players of the guest's answer. Anon text — guest is anonymous
    // from the group's perspective, so we don't expose their name. null status (clearing)
    // is not announced.
    if (status !== null) {
      enqueueRsvpAnswerNotification({
        eventId,
        eventTitle: event.title,
        status,
        actorPlayerId: playerId,
        actorName: null,
        actorIsLogged: false,
        senderClientId: session.user.id,
      }).catch(() => {});
    }

    // 3. status="no" → also archive the player (admin declines on behalf of the guest).
    let warned = false;
    if (status === "no") {
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
      const proto = request.headers.get("x-forwarded-proto") ?? "https";
      const origin = `${proto}://${host}`;
      const result = await archiveAndLeave({
        eventId,
        playerId,
        actor: { kind: "organizer", userId: session.user.id },
        origin,
      });
      warned = result.warned;
    }

    return Response.json({
      ok: true,
      status: rsvp.status,
      respondedAt: rsvp.respondedAt,
      respondedByUserId: rsvp.respondedByUserId,
      warned,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to set attendance.";
    if (/not found/i.test(message)) {
      return Response.json({ error: message }, { status: 404 });
    }
    if (/does not belong/i.test(message) || /linked/i.test(message)) {
      return Response.json({ error: message }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
};
