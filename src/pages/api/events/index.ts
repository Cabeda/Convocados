import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { checkRateLimit } from "../../../lib/rateLimit.server";
import { serializeRecurrenceRule, type RecurrenceRule } from "../../../lib/recurrence";
import { resolveLocation } from "../../../lib/geocode";
import { getSession } from "../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";

export const POST: APIRoute = async ({ request }) => {
  const limited = rateLimitResponse(request, "write");
  if (limited) return limited;

  const ip =
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";

  const { allowed } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json({ error: "Too many events created. Try again in an hour." }, { status: 429 });
  }

  const session = await getSession(request);

  const body = await request.json();
  const title = String(body.title ?? "").trim().slice(0, 100);
  const location = String(body.location ?? "").trim().slice(0, 200);
  const dateTimeRaw = String(body.dateTime ?? "");
  const teamOneName = String(body.teamOneName ?? "Ninjas").trim().slice(0, 50) || "Ninjas";
  const teamTwoName = String(body.teamTwoName ?? "Gunas").trim().slice(0, 50) || "Gunas";
  const maxPlayersRaw = parseInt(String(body.maxPlayers ?? "10"), 10);
  const maxPlayers = isNaN(maxPlayersRaw) || maxPlayersRaw < 2 ? 10 : Math.min(maxPlayersRaw, 100);
  const sport = String(body.sport ?? "football-5v5").trim().slice(0, 50) || "football-5v5";
  const isPublic = Boolean(body.isPublic);
  const isRecurring = Boolean(body.isRecurring);
  const recurrenceFreq = (body.recurrenceFreq ?? null) as "weekly" | "monthly" | null;
  const recurrenceInterval = parseInt(String(body.recurrenceInterval ?? "1"), 10);
  const recurrenceByDay = (body.recurrenceByDay ?? null) as string | null;

  if (!title) return Response.json({ error: "Title is required." }, { status: 400 });
  if (!dateTimeRaw) return Response.json({ error: "Date and time are required." }, { status: 400 });

  const dateTime = new Date(dateTimeRaw);
  if (isNaN(dateTime.getTime())) return Response.json({ error: "Invalid date/time." }, { status: 400 });
  if (dateTime < new Date()) return Response.json({ error: "Event must be in the future." }, { status: 400 });

  let recurrenceRule: string | null = null;
  let nextResetAt: Date | null = null;

  if (isRecurring && recurrenceFreq) {
    const rule: RecurrenceRule = {
      freq: recurrenceFreq,
      interval: isNaN(recurrenceInterval) || recurrenceInterval < 1 ? 1 : recurrenceInterval,
      ...(recurrenceByDay ? { byDay: recurrenceByDay } : {}),
    };
    recurrenceRule = serializeRecurrenceRule(rule);
    nextResetAt = new Date(dateTime.getTime() + 60 * 60 * 1000);
  }

  // Geocode location (non-blocking failure — coordinates are optional)
  const geo = location ? await resolveLocation(location) : null;

  const event = await prisma.event.create({
    data: {
      title, location, dateTime, maxPlayers, teamOneName, teamTwoName, sport, isPublic, isRecurring, recurrenceRule, nextResetAt,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      ownerId: session?.user?.id ?? null,
    },
  });

  return Response.json({ id: event.id });
};
