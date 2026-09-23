import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { isGameEnded } from "../../../../lib/gameStatus";
import { archiveAndLeave } from "../../../../lib/leave.server";
import { applyRosterChange, resetInviteRateLimitStores } from "../../../../lib/applyRosterChange.server";
import {
  IDEMPOTENCY_HEADER,
  getCachedResponse,
  hasConflictingEntry,
  hashPayload,
  makeCacheKey,
  storeCachedResponse,
  startIdempotencySweep,
} from "../../../../lib/idempotency";

export { resetInviteRateLimitStores };

startIdempotencySweep();

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const idemKey = request.headers.get(IDEMPOTENCY_HEADER);
  const sessionForIdem = idemKey ? await getSession(request) : null;
  const idemUserId = sessionForIdem?.user?.id ?? null;
  const idemPath = `/api/events/${eventId}/players`;
  const idemCacheKey = idemKey ? makeCacheKey(idemKey, idemPath, idemUserId) : null;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const session = await getSession(request);
  const senderClientId = session?.user?.id ?? request.headers.get("x-client-id") ?? undefined;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // ADR-0021: joining an un-adopted Open Pickup is blocked until someone adopts.
  const pickupGate = await prisma.event.findUnique({
    where: { id: eventId },
    select: { source: true, ownerId: true },
  });
  if (pickupGate?.source === "playtomic" && pickupGate.ownerId === null) {
    return Response.json(
      { error: "This is an open pickup — claim it first." },
      { status: 409 },
    );
  }

  // Once the game has ended, the roster is frozen on the event page — players
  // must not be added after kickoff. Post-game roster fixes go through the
  // game history (PATCH /history) instead.
  if (isGameEnded(event.dateTime, event.durationMinutes)) {
    return Response.json(
      { error: "The game has already ended — players can no longer be added." },
      { status: 403 },
    );
  }

  const { name, linkToAccount, email } = await request.json();

  // Idempotency replay check: if the same key + same body was already processed,
  // return the cached 2xx response. Mismatched body returns 422.
  if (idemKey && idemCacheKey) {
    const bodyHash = hashPayload({ name, linkToAccount, email } as Record<string, unknown>);
    const cached = getCachedResponse(idemCacheKey, bodyHash);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { "content-type": cached.contentType },
      });
    }
    if (hasConflictingEntry(idemCacheKey, bodyHash)) {
      return Response.json(
        { error: "Idempotency-Key reused with different payload" },
        { status: 422 },
      );
    }
  }

  const result = await applyRosterChange({
    eventId,
    origin,
    session,
    senderClientId,
    body: { name, linkToAccount, email },
    event,
  });

  // Cache the 2xx response for replay on retry with the same Idempotency-Key.
  if (idemKey && idemCacheKey && result.status >= 200 && result.status < 300) {
    const bodyHash = hashPayload({ name, linkToAccount, email } as Record<string, unknown>);
    const text = JSON.stringify(result.body);
    storeCachedResponse(idemCacheKey, bodyHash, result.status, text, "application/json");
  }

  return Response.json(result.body, { status: result.status });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const { playerId } = await request.json();
  const session = await getSession(request);

  let player = await prisma.player.findFirst({
    where: { id: playerId, eventId, archivedAt: null },
    include: { event: { select: { ownerId: true } } },
  });
  // ADR 0016: Event GET now returns EventPlayer IDs. Fall back to name-based lookup.
  if (!player) {
    const ep = await prisma.eventPlayer.findFirst({ where: { id: playerId, eventId } });
    if (ep) {
      player = await prisma.player.findFirst({
        where: { eventId, name: ep.name, archivedAt: null },
        include: { event: { select: { ownerId: true } } },
      });
    }
  }
  if (!player) return Response.json({ error: "Not found." }, { status: 404 });

  // Protected player check: players with userId can only be removed by themselves or the event owner.
  if (player.userId) {
    const isSelf = session?.user?.id === player.userId;
    const { isOwner, isAdmin } = await checkOwnership(request, player.event.ownerId, session, eventId);
    if (!isSelf && !isOwner && !isAdmin) {
      return Response.json({ error: "This player is account-linked and can only be removed by themselves or the event owner." }, { status: 403 });
    }
  }

  // Soft-archive + notify + log + re-index, with the warn-the-rest push gated on (48h + bench-empty).
  // Self-removal (the player is removing themselves) uses actor.kind="self" so the auto-unfollow fires.
  const isSelf = session?.user?.id && player.userId === session.user.id;
  // For unauthenticated requests, pass null as the actor id (lib skips the Rsvp audit row,
  // which has a FK to User). Real authenticated users get a FK-safe actor id.
  const actorUserId = session?.user?.id ?? player.event.ownerId ?? null;
  const result = await archiveAndLeave({
    eventId,
    playerId: player.id,
    actor: isSelf
      ? { kind: "self", userId: actorUserId }
      : { kind: "organizer", userId: actorUserId },
    origin,
  });
  return Response.json({
    ok: true,
    warned: result.warned,
    undo: result.undo,
  });
};
