import type { APIRoute } from "astro";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getSession } from "~/lib/auth.helpers.server";
import { archiveAndLeave } from "~/lib/leave.server";
import { rosteredEventPlayerForUser } from "~/lib/rosterChange.server";

/** POST /api/events/[id]/leave — authenticated user leaves an event they were a Player in.
 *  On success: Player.archivedAt is set, Rsvp.status = "no", auto-unfollow.
 *  If within 48h before kickoff AND the bench is empty after, fires the existing player_left push. */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  // Resolve the caller's roster identity from the AUTHORITATIVE roster
  // (ADR 0016: the event GET renders GameParticipant + EventPlayer, so that is
  // what "you are on the list" means to the user). The legacy `Player` table is
  // not authoritative: an EventPlayer-native identity (ADR 0026 guest invite,
  // or a re-join under a renamed display name) can be live on the current game
  // with no non-archived Player row at all — looking only there answered 404
  // "You are not a player in this event." to a player the page just showed as
  // joined. Fall back to the Player table so ownerless/legacy events still work.
  const { prisma } = await import("~/lib/db.server");
  const ep = await rosteredEventPlayerForUser(eventId, session.user.id);
  const player = await prisma.player.findFirst({
    where: { eventId, userId: session.user.id, archivedAt: null },
    select: { id: true, name: true },
  });

  const identity = ep ?? player;
  if (!identity) {
    return Response.json({ error: "You are not a player in this event." }, { status: 404 });
  }

  try {
    const result = await archiveAndLeave({
      eventId,
      // Pass the Player row only when it matches the identity we resolved —
      // a stale row under a different name would archive the wrong person.
      playerId: player && player.name === identity.name ? player.id : null,
      name: identity.name,
      actor: { kind: "self", userId: session.user.id },
      origin,
    });
    return Response.json({
      ok: true,
      warned: result.warned,
      benchEmptyAfter: result.benchEmptyAfter ?? null,
      undo: result.undo,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to leave.";
    if (/not found/i.test(message)) {
      return Response.json({ error: message }, { status: 404 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
};
