import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { validateFeedToken } from "../../../../lib/calendarToken.server";
import { generateIcsFeed } from "../../../../lib/calendar";
import { parseRecurrenceRule } from "../../../../lib/recurrence";

/**
 * GET /api/users/:id/calendar.ics?token=xxx
 * Returns an iCal feed of all upcoming games for a user.
 * Authenticated via private feed token (query param).
 */
export const GET: APIRoute = async ({ params, request }) => {
  const userId = params.id!;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 401 });
  }

  const tokenData = await validateFeedToken(token);
  if (!tokenData || tokenData.userId !== userId || tokenData.scope !== "user") {
    return new Response("Invalid or expired token", { status: 403 });
  }

  const now = new Date();

  // Fetch upcoming events the user owns
  const ownedEvents = await prisma.event.findMany({
    where: { ownerId: userId, dateTime: { gte: now } },
    orderBy: { dateTime: "asc" },
    take: 200,
  });

  // Fetch upcoming events the user has joined
  const playerEntries = await prisma.player.findMany({
    where: { userId, event: { dateTime: { gte: now } } },
    select: { event: true },
    take: 200,
  });

  // Deduplicate
  const ownedIds = new Set(ownedEvents.map((e) => e.id));
  const allEvents = [
    ...ownedEvents,
    ...playerEntries.map((p) => p.event).filter((e) => !ownedIds.has(e.id)),
  ];

  // Sort by date
  allEvents.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.fly.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";

  const calendarEvents = allEvents.map((e) => ({
    id: e.id,
    title: e.title,
    location: e.location,
    dateTime: e.dateTime,
    url: `${proto}://${host}/events/${e.id}`,
    description: `Convocados game — ${e.title}`,
    recurrence: e.isRecurring ? parseRecurrenceRule(e.recurrenceRule) : null,
  }));

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const ics = generateIcsFeed(calendarEvents, `Convocados — ${user?.name ?? "Games"}`);

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
};
