import type { APIRoute } from "astro";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { getSession } from "~/lib/auth.helpers.server";
import { archiveAndLeave } from "~/lib/leave.server";

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

  // Find the Player row for this user in this event.
  const { prisma } = await import("~/lib/db.server");
  const player = await prisma.player.findFirst({
    where: { eventId, userId: session.user.id, archivedAt: null },
    select: { id: true },
  });
  if (!player) {
    return Response.json({ error: "You are not a player in this event." }, { status: 404 });
  }

  try {
    const result = await archiveAndLeave({
      eventId,
      playerId: player.id,
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
