import type { APIRoute } from "astro";
import { getSession } from "../../../lib/auth.helpers.server";
import {
  getOrCreateUserFeedToken,
  revokeUserTokens,
  getOrCreateEventFeedToken,
} from "../../../lib/calendarToken.server";

/** POST — generate (or retrieve) a calendar feed token for the authenticated user */
export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const scope: string = body.scope ?? "user";
  const eventId: string | undefined = body.eventId;

  if (scope === "event") {
    if (!eventId) {
      return Response.json({ error: "eventId is required for event scope." }, { status: 400 });
    }
    const token = await getOrCreateEventFeedToken(session.user.id, eventId);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost";
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const feedUrl = `${proto}://${host}/api/events/${eventId}/calendar.ics?token=${token}`;
    return Response.json({ token, feedUrl });
  }

  const token = await getOrCreateUserFeedToken(session.user.id);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const feedUrl = `${proto}://${host}/api/users/${session.user.id}/calendar.ics?token=${token}`;
  return Response.json({ token, feedUrl });
};

/** DELETE — revoke all calendar tokens and regenerate */
export const DELETE: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await revokeUserTokens(session.user.id);
  return Response.json({ ok: true });
};
