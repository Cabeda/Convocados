import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { upsertRsvp, getRsvpForUser } from "~/lib/rsvp.server";
import { isRsvpStatusValue } from "~/lib/rsvp";
import { enqueueRsvpAnswerNotification } from "~/lib/rsvp-notifications.server";
import { logEvent } from "~/lib/eventLog.server";
import { IDEMPOTENCY_HEADER, getCachedResponse, makeCacheKey, hasConflictingEntry, storeCachedResponse } from "~/lib/idempotency";

/** POST /api/events/[id]/rsvp — body { status: "yes" | "no" | "maybe" }. Idempotent. */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, dateTime: true, title: true, ownerId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // RSVP closes at kickoff
  if (event.dateTime.getTime() <= Date.now()) {
    return Response.json({ error: "The game has already started." }, { status: 409 });
  }

  const idemKey = request.headers.get(IDEMPOTENCY_HEADER);
  const idemPath = `/api/events/${eventId}/rsvp`;
  const idemCacheKey = idemKey ? makeCacheKey(idemKey, idemPath, session.user.id) : null;
  let body: { status?: string } = {};
  try { body = await request.json(); } catch { /* fall through */ }
  if (!isRsvpStatusValue(body.status)) {
    return Response.json({ error: "status must be 'yes', 'no', or 'maybe'." }, { status: 400 });
  }

  if (idemKey && idemCacheKey) {
    // RSVP body is { status: "yes"|"no"|"maybe" } — hash raw body, not the add-player canonicalizer.
    const bodyHash = createHash("sha256").update(JSON.stringify({ status: body.status })).digest("hex");
    const cached = getCachedResponse(idemCacheKey, bodyHash);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { "content-type": cached.contentType },
      });
    }
    if (hasConflictingEntry(idemCacheKey, bodyHash)) {
      return Response.json({ error: "Idempotency-Key reused with different payload" }, { status: 422 });
    }
  }

  const rsvp = await upsertRsvp(eventId, session.user.id, body.status);

  enqueueRsvpAnswerNotification({
    eventId,
    eventTitle: event.title,
    status: body.status,
    actorUserId: session.user.id,
    actorName: session.user.name,
    actorIsLogged: true,
  }).catch(() => {});

  logEvent(
    eventId,
    body.status === "yes" ? "rsvp_yes" : body.status === "no" ? "rsvp_no" : "rsvp_maybe",
    session.user.name,
    session.user.id,
    { eventTitle: event.title, status: body.status },
  ).catch(() => {});

  const response = Response.json({ ok: true, status: rsvp.status, respondedAt: rsvp.respondedAt });
  if (idemKey && idemCacheKey) {
    const bodyHash = createHash("sha256").update(JSON.stringify({ status: body.status })).digest("hex");
    const responseClone = response.clone();
    const text = await responseClone.text();
    storeCachedResponse(idemCacheKey, bodyHash, 200, text, "application/json");
  }
  return response;
};

/** GET /api/events/[id]/rsvp — current user's RSVP. */
export const GET: APIRoute = async ({ params, request }) => {
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const rsvp = await getRsvpForUser(params.id ?? "", session.user.id);
  return Response.json({ status: rsvp?.status ?? null, respondedAt: rsvp?.respondedAt ?? null });
};
