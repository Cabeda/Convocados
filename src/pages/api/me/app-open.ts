import type { APIRoute } from "astro";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { recordAppOpen } from "../../../lib/rsvp.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";

/**
 * POST /api/me/app-open — native app-open heartbeat (GH #1070).
 *
 * The middleware heartbeat only counts HTML navigations, so OAuth-bearer
 * native clients (Android :app/:wear, iOS) were invisible to DAU/WAU/MAU.
 * Each native client calls this once per app open; `recordAppOpen` is
 * idempotent per user per UTC day.
 */
export const POST: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const authCtx = await authenticateRequest(request);
  if (!authCtx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await recordAppOpen(authCtx.userId);
  return Response.json({ ok: true });
};
