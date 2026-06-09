import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";

const VALID_FIELDS = ["mutePlayerActivity", "muteReminders", "mutePostGame", "muteEventDetails"] as const;

/**
 * GET /api/events/[id]/notification-defaults — get event notification defaults.
 * PUT /api/events/[id]/notification-defaults — set defaults (admin/owner only).
 */
export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { notificationDefaults: true } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });
  const defaults = event.notificationDefaults ? JSON.parse(event.notificationDefaults) : {};
  return Response.json(defaults);
};

export const PUT: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const auth = await checkOwnership(request, eventId);
  if (!auth.isOwner && !auth.isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const data: Record<string, boolean | null> = {};
  for (const field of VALID_FIELDS) {
    if (field in body) {
      const val = body[field];
      if (val !== null && typeof val !== "boolean") return Response.json({ error: `"${field}" must be boolean or null` }, { status: 400 });
      data[field] = val as boolean | null;
    }
  }

  // Merge with existing defaults
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { notificationDefaults: true } });
  const existing = event?.notificationDefaults ? JSON.parse(event.notificationDefaults) : {};
  const merged = { ...existing, ...data };

  // Remove null values (null = reset to system default)
  for (const key of Object.keys(merged)) {
    if (merged[key] === null) delete merged[key];
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { notificationDefaults: Object.keys(merged).length > 0 ? JSON.stringify(merged) : null },
  });

  return Response.json(merged);
};
