import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";

/**
 * POST /api/events/[id]/invitation-opt-out
 * ADR 0025 — per-event invite opt-out toggle for the authenticated user's own
 * EventPlayer entry. While set, RSVP pings, recruitment/spot-available pings,
 * suggestions and PlayerInvite creation are suppressed for this event.
 * Reversible — cleared automatically on rejoin (players.ts) or manually here.
 * Body: { optOut: boolean }
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: { optOut?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.optOut !== "boolean") {
    return Response.json({ error: "optOut must be a boolean." }, { status: 400 });
  }

  const ep = await prisma.eventPlayer.findFirst({
    where: { eventId, userId: session.user.id },
    select: { id: true },
  });
  if (!ep) {
    return Response.json({ error: "You are not a player in this event." }, { status: 404 });
  }

  await prisma.eventPlayer.update({
    where: { id: ep.id },
    data: { invitationOptOutAt: body.optOut ? new Date() : null },
  });

  return Response.json({ ok: true, optedOut: body.optOut });
};