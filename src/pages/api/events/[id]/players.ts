import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { isGameEnded } from "../../../../lib/gameStatus";
import { archiveAndLeave } from "../../../../lib/leave.server";
import { activeRosterEventPlayerById } from "../../../../lib/rosterChange.server";
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

  // ADR 0016: the roster the event page renders is GameParticipant + EventPlayer,
  // but this gate looked only for an un-archived legacy Player row. Reactivation
  // paths — accepting a re-invite, confirming a priority spot — put someone back on
  // the roster without restoring that row, so the x answered 404 for a player the
  // list was showing, with no way off it (#1237). Resolve the roster name and let
  // archiveAndLeave work from it, the same way the self-leave path does.
  //
  // This only reads. Keeping resolution side-effect free is what guarantees the 403
  // below has not already changed anything.
  const owner = await prisma.event.findUnique({ where: { id: eventId }, select: { ownerId: true } });
  if (!owner) return Response.json({ error: "Not found." }, { status: 404 });

  const row = await prisma.player.findFirst({
    where: { id: playerId, eventId, archivedAt: null },
    select: { id: true, name: true, userId: true },
  });
  // The event GET hands out EventPlayer ids (ADR 0016), so that is the common case.
  // Restricted to the *active* roster: a pending invite ghost is not a player yet
  // (ADR 0025) and is retracted by its own action, so the x must not act on one —
  // otherwise an anonymous caller could cancel someone's invite.
  const roster = row ? null : await activeRosterEventPlayerById(eventId, playerId);
  const name = row?.name ?? roster?.name;
  if (!name) return Response.json({ error: "Not found." }, { status: 404 });
  // The legacy Player row carries the authoritative account link — the read path
  // trusts Player.userId for exactly this reason (index.ts). A roster row with no
  // userId must therefore still fall back to it, including when that Player row is
  // archived: gameDualWrite creates unlinked EventPlayers, so "no userId on the
  // roster row" does not mean "anonymous", and trusting that alone would skip the
  // gate below and let an unauthenticated x remove an account-linked player.
  const linked = row ?? await prisma.player.findFirst({
    where: { eventId, name },
    select: { id: true, name: true, userId: true },
  });
  const subjectUserId = roster?.userId ?? linked?.userId ?? null;

  // Protected player check: players with userId can only be removed by themselves or the event owner.
  if (subjectUserId) {
    const isSelf = session?.user?.id === subjectUserId;
    const { isOwner, isAdmin } = await checkOwnership(request, owner.ownerId, session, eventId);
    if (!isSelf && !isOwner && !isAdmin) {
      return Response.json({ error: "This player is account-linked and can only be removed by themselves or the event owner." }, { status: 403 });
    }
  }

  // Soft-archive + notify + log + re-index, with the warn-the-rest push gated on (48h + bench-empty).
  // Self-removal (the player is removing themselves) uses actor.kind="self" so the auto-unfollow fires.
  const isSelf = !!session?.user?.id && subjectUserId === session.user.id;
  // For unauthenticated requests, pass null as the actor id (lib skips the Rsvp audit row,
  // which has a FK to User). Real authenticated users get a FK-safe actor id.
  const actorUserId = session?.user?.id ?? owner.ownerId ?? null;
  const result = await archiveAndLeave({
    eventId,
    // The Player row only when it is the active row we just resolved — otherwise
    // archiveAndLeave works from `name`, which is how it finds the roster row for a
    // player whose Player row is archived or absent. `linked` is resolved by name,
    // so it is the row the list is showing: without it a remove that arrived with
    // an EventPlayer id archived the game row but left the legacy Player row live.
    playerId: row?.id ?? linked?.id ?? null,
    name,
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
