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

  // Platform drives the admin Android/iOS/Web split. Body is optional: older
  // clients send none and are attributed to "android" (the only native client
  // when this endpoint shipped); iOS sends "ios".
  let platform: "android" | "ios" = "android";
  const body = await request.json().catch(() => null) as { platform?: unknown } | null;
  const raw = typeof body?.platform === "string" ? body.platform.trim().toLowerCase() : "";
  if (raw === "ios") platform = "ios";

  await recordAppOpen(authCtx.userId, new Date(), platform);
  return Response.json({ ok: true });
};
