import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";

/**
 * POST /api/push/subscribe — register a web push endpoint for the authenticated user.
 * This is per-user (not per-event). Which events notify this user is determined by EventFollow.
 */
export const POST: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const session = await getSession(request);
  if (!session?.user?.id) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { endpoint, keys, locale } = await request.json();
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return Response.json({ error: "Invalid subscription." }, { status: 400 });
  }

  // ponytail: cap subscriptions per user to prevent abuse (e.g. registering thousands of endpoints)
  const count = await prisma.pushSubscription.count({ where: { userId: session.user.id } });
  if (count >= 10) {
    return Response.json({ error: "Too many push subscriptions. Remove old devices first." }, { status: 429 });
  }

  const lang = typeof locale === "string" && locale.toLowerCase().startsWith("pt") ? "pt" : "en";

  await prisma.pushSubscription.upsert({
    where: { userId_endpoint: { userId: session.user.id, endpoint } },
    create: { userId: session.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, locale: lang },
    update: { p256dh: keys.p256dh, auth: keys.auth, locale: lang },
  });

  return Response.json({ ok: true });
};

/**
 * DELETE /api/push/subscribe — unregister a web push endpoint for the authenticated user.
 */
export const DELETE: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user?.id) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { endpoint } = await request.json();
  if (!endpoint) return Response.json({ error: "Missing endpoint." }, { status: 400 });

  await prisma.pushSubscription.deleteMany({ where: { userId: session.user.id, endpoint } });
  return Response.json({ ok: true });
};
