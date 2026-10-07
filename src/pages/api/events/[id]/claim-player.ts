import type { APIRoute } from "astro";
import { getSession } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { claimPlayer } from "../../../../lib/claimPlayer.server";

/** POST — claim an anonymous player: replace it with the authenticated user's identity */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { playerId } = await request.json();
  if (!playerId) {
    return Response.json({ error: "playerId is required." }, { status: 400 });
  }

  try {
    const result = await claimPlayer(eventId, {
      playerId,
      userId: session.user.id,
      userName: session.user.name,
    });
    return Response.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message === "Event not found") {
      return Response.json({ error: message }, { status: 404 });
    }
    if (message === "Player not found.") {
      return Response.json({ error: message }, { status: 404 });
    }
    if (message.includes("already linked") || message.includes("already have")) {
      return Response.json({ error: message }, { status: 409 });
    }
    if (message.includes("already claimed")) {
      return Response.json({ error: message }, { status: 409 });
    }
    throw err;
  }
};
