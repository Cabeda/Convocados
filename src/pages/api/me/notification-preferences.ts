import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { DEFAULTS } from "~/lib/notificationPrefs.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("notification-prefs");

const BOOLEAN_FIELDS = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];

/** GET /api/me/notification-preferences — get current user's notification preferences */
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prefs = await prisma.notificationPreferences.findUnique({
    where: { userId: session.user.id },
  });

  return Response.json(prefs ?? { ...DEFAULTS, userId: session.user.id });
};

/** PUT /api/me/notification-preferences — update notification preferences */
export const PUT: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Record<string, boolean> = {};
  for (const field of BOOLEAN_FIELDS) {
    if (field in body) {
      if (typeof body[field] !== "boolean") {
        return Response.json({ error: `Field "${field}" must be a boolean` }, { status: 400 });
      }
      data[field] = body[field] as boolean;
    }
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No valid fields provided" }, { status: 400 });
  }

  const prefs = await prisma.notificationPreferences.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...DEFAULTS, ...data },
    update: data,
  });

  log.info({ userId: session.user.id, fields: Object.keys(data) }, "Notification preferences updated");

  return Response.json(prefs);
};
