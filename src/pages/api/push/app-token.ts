import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";

/**
 * POST /api/push/app-token — Register an FCM push token for the authenticated user.
 * DELETE /api/push/app-token — Remove a push token (e.g. on sign-out).
 */
export const POST: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const authCtx = await authenticateRequest(request);
  if (!authCtx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const token = String(body.token ?? "").trim();
  const platform = String(body.platform ?? "").trim();
  const locale = typeof body.locale === "string" && body.locale.trim() ? body.locale.trim().slice(0, 10) : "en";

  if (!token) {
    return Response.json({ error: "Token is required." }, { status: 400 });
  }
  if (!["ios", "android"].includes(platform)) {
    return Response.json({ error: "Platform must be 'ios' or 'android'." }, { status: 400 });
  }

  await prisma.appPushToken.upsert({
    where: { token },
    create: { userId: authCtx.userId, token, platform, locale },
    update: { userId: authCtx.userId, platform, locale, updatedAt: new Date() },
  });

  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ request }) => {
  const authCtx = await authenticateRequest(request);
  if (!authCtx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const token = String(body.token ?? "").trim();

  if (!token) {
    return Response.json({ error: "Token is required." }, { status: 400 });
  }

  await prisma.appPushToken.deleteMany({
    where: { token, userId: authCtx.userId },
  });

  return Response.json({ ok: true });
};
