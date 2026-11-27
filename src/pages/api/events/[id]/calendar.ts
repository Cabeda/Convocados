import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { generateIcs } from "../../../../lib/calendar";
import { parseRecurrenceRule } from "../../../../lib/recurrence";
import { checkAccess } from "../../../../lib/eventAccess";
import { isValidEventFeedToken } from "../../../../lib/calendarToken.server";
import { authenticateRequest } from "../../../../lib/authenticate.server";
import { checkEventAdmin } from "../../../../lib/auth.helpers.server";

/**
 * A locked Event answers the same gate as its other reads: owner/admin,
 * invitee, an `ev_access` cookie, or an event-scoped feed token. Unlocked
 * Events stay anonymously exportable so existing calendar subscriptions work.
 */
async function canReadLockedEventCalendar(
  request: Request,
  event: { id: string; ownerId: string | null; accessPassword: string | null },
): Promise<boolean> {
  const token = new URL(request.url).searchParams.get("token");
  if (await isValidEventFeedToken(token, event.id)) return true;

  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? null;
  const [isInvited, isAdmin] = userId
    ? await Promise.all([
        prisma.eventInvite.count({ where: { eventId: event.id, userId } }).then((count) => count > 0),
        checkEventAdmin(event.id, userId),
      ])
    : [false, false];

  return checkAccess({
    eventOwnerId: event.ownerId,
    accessPassword: event.accessPassword,
    requestUserId: userId,
    cookieHeader: request.headers.get("cookie"),
    eventId: event.id,
    isInvited: isInvited || isAdmin,
  }).granted;
}

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return new Response("Not found", { status: 404 });

  if (event.accessPassword && !(await canReadLockedEventCalendar(request, event))) {
    return new Response("Forbidden", { status: 403 });
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/events/${event.id}`;

  const recurrence = event.isRecurring ? parseRecurrenceRule(event.recurrenceRule) : null;

  const ics = generateIcs({
    id: event.id,
    title: event.title,
    location: event.location,
    dateTime: event.dateTime,
    url,
    description: `Convocados game — ${event.title}`,
    recurrence,
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.title.replace(/[^a-zA-Z0-9]/g, "_")}.ics"`,
    },
  });
};
