import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { validateFeedToken } from "../../../../lib/calendarToken.server";
import { generateIcsFeed } from "../../../../lib/calendar";
import { parseRecurrenceRule } from "../../../../lib/recurrence";

/**
 * GET /api/events/:id/calendar.ics?token=xxx
 * Returns an iCal feed for all upcoming games in an event (group).
 * Authenticated via private feed token (query param).
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id!;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 401 });
  }

  const tokenData = await validateFeedToken(token);
  if (!tokenData || tokenData.scope !== "event" || tokenData.scopeId !== eventId) {
    return new Response("Invalid or expired token", { status: 403 });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return new Response("Event not found", { status: 404 });
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.fly.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";

  const calendarEvents = [
    {
      id: event.id,
      title: event.title,
      location: event.location,
      dateTime: event.dateTime,
      url: `${proto}://${host}/events/${event.id}`,
      description: `Convocados game — ${event.title}`,
      recurrence: event.isRecurring ? parseRecurrenceRule(event.recurrenceRule) : null,
    },
  ];

  const ics = generateIcsFeed(calendarEvents, `Convocados — ${event.title}`);

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
};
