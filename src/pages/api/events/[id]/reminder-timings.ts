import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

const FIELDS = ["reminder24h", "reminder2h", "reminder1h"] as const;

/**
 * Reminder Timings — which pre-game reminders exist for this event. Gates
 * every channel at emission (push, email, webhook); user reminder prefs AND
 * with these for individual delivery. Supersedes notificationDefaults'
 * retired muteReminders key.
 *
 * GET  /api/events/[id]/reminder-timings — current gate
 * PUT  /api/events/[id]/reminder-timings — set gate (owner/admin only)
 */
export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id ?? "" },
    select: { reminder24h: true, reminder2h: true, reminder1h: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json(event);
};

export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const authzEvent = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true, isPublic: true },
  });
  if (!authzEvent) return Response.json({ error: "Not found." }, { status: 404 });
  const authz = await authorizeEventMutation(request, authzEvent);
  if (!authz.allowed) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Partial<Record<(typeof FIELDS)[number], boolean>> = {};
  for (const field of FIELDS) {
    if (field in body) {
      if (typeof body[field] !== "boolean") {
        return Response.json({ error: `"${field}" must be boolean` }, { status: 400 });
      }
      data[field] = body[field] as boolean;
    }
  }
  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data,
    select: { reminder24h: true, reminder2h: true, reminder1h: true },
  });
  return Response.json(updated);
};
