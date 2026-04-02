import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";

export const POST: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { endpoint, keys, locale, clientId } = await request.json();
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return Response.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const lang = typeof locale === "string" && locale.toLowerCase().startsWith("pt") ? "pt" : "en";
  const cid = typeof clientId === "string" ? clientId : "";
  const session = await getSession(request);
  const userId = session?.user?.id ?? null;

  await prisma.pushSubscription.upsert({
    where: { eventId_endpoint: { eventId, endpoint } },
    create: { eventId, endpoint, p256dh: keys.p256dh, auth: keys.auth, locale: lang, clientId: cid, userId },
    update: { p256dh: keys.p256dh, auth: keys.auth, locale: lang, clientId: cid, userId },
  });

  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const { endpoint } = await request.json();
  if (!endpoint) return Response.json({ error: "Missing endpoint." }, { status: 400 });

  await prisma.pushSubscription.deleteMany({ where: { eventId, endpoint } });
  return Response.json({ ok: true });
};
