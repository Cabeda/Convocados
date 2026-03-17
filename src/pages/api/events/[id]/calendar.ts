import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { generateIcs } from "../../../../lib/calendar";
import { parseRecurrenceRule } from "../../../../lib/recurrence";

export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return new Response("Not found", { status: 404 });

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.fly.dev";
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
