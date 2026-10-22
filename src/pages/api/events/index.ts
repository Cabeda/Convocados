import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { checkRateLimit } from "../../../lib/rateLimit.server";
import { serializeRecurrenceRule, type RecurrenceRule } from "../../../lib/recurrence";
import { resolveLocation, type GeoResult } from "../../../lib/geocode";
import { getSession } from "../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../lib/apiRateLimit.server";
import { getDefaultDurationMinutes } from "../../../lib/sports";
import { fromDateTimeLocalValue } from "../../../lib/timezones";
import { scheduleEventReminders } from "../../../lib/scheduler.server";
import { fireWebhooks } from "../../../lib/webhook.server";
import { validateWebhookUrl } from "../../../lib/webhookUrl";
import { WEBHOOK_EVENT_TYPES } from "~/lib/webhookEvents";
import { inferCity, normalizeCity } from "../../../lib/city";

export const POST: APIRoute = async ({ request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const ip =
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";

  const { allowed } = await checkRateLimit(ip);
  if (!allowed) {
    return Response.json({ error: "Too many events created. Try again in an hour." }, { status: 429 });
  }

  const session = await getSession(request);

  const body = await request.json();
  const title = String(body.title ?? "").trim().slice(0, 100);
  const location = String(body.location ?? "").trim().slice(0, 200);
  // #1445: an explicit city wins (the form pre-fills the guess and lets the
  // organizer override it); an absent one is guessed from the stored location,
  // which the geocoder may have replaced with a canonical name.
  const cityGiven = body.city !== undefined;
  const cityRaw = String(body.city ?? "").trim().slice(0, 80);
  const dateTimeRaw = String(body.dateTime ?? "");
  const timezoneRaw = String(body.timezone ?? "UTC").trim().slice(0, 100);
  const teamOneName = String(body.teamOneName ?? "Ninjas").trim().slice(0, 50) || "Ninjas";
  const teamTwoName = String(body.teamTwoName ?? "Gunas").trim().slice(0, 50) || "Gunas";
  const maxPlayersRaw = parseInt(String(body.maxPlayers ?? "10"), 10);
  const maxPlayers = isNaN(maxPlayersRaw) || maxPlayersRaw < 2 ? 10 : Math.min(maxPlayersRaw, 100);
  const sport = String(body.sport ?? "football-5v5").trim().slice(0, 50) || "football-5v5";
  // Discoverability default: a signed-in organiser's new game is public
  // (discoverable) unless they explicitly opt out — an absent isPublic means
  // "on". Anonymous creations stay unlisted: they have no owner, and an
  // ownerless *public* Event cannot be mutated until adopted, so defaulting
  // them public would make an anonymous game uneditable by its creator.
  const isPublic =
    body.isPublic === undefined || body.isPublic === null
      ? Boolean(session?.user?.id)
      : Boolean(body.isPublic);
  const isRecurring = Boolean(body.isRecurring);
  const VALID_FREQS = ["daily", "weekly", "monthly", "yearly"] as const;
  const rawFreq = body.recurrenceFreq ?? null;
  const recurrenceFreq = rawFreq && VALID_FREQS.includes(rawFreq) ? (rawFreq as typeof VALID_FREQS[number]) : null;
  const recurrenceInterval = parseInt(String(body.recurrenceInterval ?? "1"), 10);
  const recurrenceByDay = (body.recurrenceByDay ?? null) as string | null;

  if (!title) return Response.json({ error: "Title is required." }, { status: 400 });
  if (!dateTimeRaw) return Response.json({ error: "Date and time are required." }, { status: 400 });

  // Optional creation-time webhook wiring (validated up-front so a bad config
  // never creates an unwired event).
  const webhookUrlRaw = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";
  const webhookSecret = typeof body.webhookSecret === "string" ? body.webhookSecret : null;
  const webhookEventsRequested: unknown[] = Array.isArray(body.webhookEvents) ? body.webhookEvents : [];
  if (webhookEventsRequested.length > 0) {
    const invalid = webhookEventsRequested.filter((e: unknown) => !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e as string));
    if (invalid.length > 0) {
      return Response.json(
        { error: `Unknown event type(s): ${invalid.join(", ")}. Valid: ${WEBHOOK_EVENT_TYPES.join(", ")}` },
        { status: 400 },
      );
    }
  }
  let webhookUrl: string | null = null;
  if (webhookUrlRaw) {
    const urlError = validateWebhookUrl(webhookUrlRaw);
    if (urlError) return Response.json({ error: urlError }, { status: 400 });
    webhookUrl = webhookUrlRaw;
  }

  // Validate timezone first — needed for dateTime conversion below
  let timezone = "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezoneRaw });
    timezone = timezoneRaw;
  } catch {
    // fall back to UTC silently
  }

  // If the client sends a datetime-local value (no Z/offset suffix), convert
  // it from the provided timezone to UTC. If it's already a UTC ISO string,
  // new Date() handles it correctly.
  let dateTime: Date;
  const looksLikeUtc = /[Zz]$/.test(dateTimeRaw) || /[+-]\d{2}:\d{2}$/.test(dateTimeRaw);
  if (!looksLikeUtc && timezone !== "UTC") {
    dateTime = new Date(fromDateTimeLocalValue(dateTimeRaw, timezone));
  } else {
    dateTime = new Date(dateTimeRaw);
  }
  if (isNaN(dateTime.getTime())) return Response.json({ error: "Invalid date/time." }, { status: 400 });
  if (dateTime < new Date()) return Response.json({ error: "Event must be in the future." }, { status: 400 });

  let recurrenceRule: string | null = null;
  let nextResetAt: Date | null = null;
  const durationMinutes = getDefaultDurationMinutes(sport);

  if (isRecurring && recurrenceFreq) {
    const rule: RecurrenceRule = {
      freq: recurrenceFreq,
      interval: isNaN(recurrenceInterval) || recurrenceInterval < 1 ? 1 : recurrenceInterval,
      ...(recurrenceByDay ? { byDay: recurrenceByDay } : {}),
    };
    recurrenceRule = serializeRecurrenceRule(rule);
    nextResetAt = new Date(dateTime.getTime() + durationMinutes * 60 * 1000);
  }

  // Geocode location (non-blocking failure — coordinates are optional)
  // Use explicit coordinates if provided (e.g. from Playtomic court finder), otherwise resolve from location text
  const explicitLat = typeof body.latitude === "number" ? body.latitude : null;
  const explicitLng = typeof body.longitude === "number" ? body.longitude : null;
  const geo: GeoResult | null = (explicitLat !== null && explicitLng !== null)
    ? { latitude: explicitLat, longitude: explicitLng }
    : location ? await resolveLocation(location) : null;

  // Maps links resolve to a friendly place name — display it instead of the raw URL
  const storedLocation = geo?.name ?? location;
  const city = cityGiven ? normalizeCity(cityRaw) : inferCity(storedLocation);

  // Event + first Game + optional webhook subscription land atomically — a
  // half-created event that no subscription knows about would silently miss
  // every later fact.
  const event = await prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        title, location: storedLocation, dateTime, timezone, maxPlayers, teamOneName, teamTwoName, sport, isPublic, isRecurring, recurrenceRule, nextResetAt,
        durationMinutes,
        city: city || null,
        latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null,
        ownerId: session?.user?.id ?? null,
      },
    });

    // ADR 0016: create the first Game for this Event
    const game = await tx.game.create({
      data: { eventId: event.id, dateTime },
    });
    await tx.event.update({
      where: { id: event.id },
      data: { currentGameId: game.id },
    });

    if (webhookUrl) {
      await tx.webhookSubscription.create({
        data: {
          eventId: event.id,
          url: webhookUrl,
          secret: webhookSecret,
          events: JSON.stringify(webhookEventsRequested as string[]),
        },
      });
    }
    return event;
  });

  // Schedule reminder jobs — wrapped in try/catch so event creation never fails because of scheduling
  try {
    await scheduleEventReminders(event.id, event.dateTime, event.durationMinutes);
  } catch {
    // ignore scheduling failures
  }

  // Fire game_scheduled (non-blocking) — lean fact, client renders
  fireWebhooks(event.id, "game_scheduled", {}).catch(() => {});

  return Response.json({ id: event.id });
};
