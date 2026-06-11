import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { searchCourtAlternatives, parseCourtWatchConfig, type CourtWatchConfig } from "~/lib/courtAlternatives.server";
import { isPlaytomicSport } from "~/lib/playtomic";

const DEFAULT_CONFIG: CourtWatchConfig = { radius: 10000, indoor: null, surface: null };

export const GET: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "read");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only event owner or admins can search alternatives." }, { status: 403 });
  }

  if (!isPlaytomicSport(event.sport)) {
    return Response.json({ error: "Sport not supported by Playtomic." }, { status: 400 });
  }

  if (!event.latitude || !event.longitude) {
    return Response.json({ error: "Event must have coordinates to search alternatives." }, { status: 400 });
  }

  const config = parseCourtWatchConfig(event.courtWatchConfig) ?? DEFAULT_CONFIG;

  // Allow query params to override config for one-off searches
  const url = new URL(request.url);
  const radius = Number(url.searchParams.get("radius")) || config.radius;
  const indoor = url.searchParams.has("indoor") ? url.searchParams.get("indoor") === "true" : config.indoor;
  const surface = url.searchParams.get("surface") ?? config.surface;
  const startTime = url.searchParams.get("startTime") ?? undefined; // "HH:mm"
  const endTime = url.searchParams.get("endTime") ?? undefined;     // "HH:mm"

  const { alternatives, error } = await searchCourtAlternatives({
    sport: event.sport,
    dateTime: event.dateTime,
    durationMinutes: event.durationMinutes,
    latitude: event.latitude,
    longitude: event.longitude,
    config: { radius, indoor, surface },
    startTime,
    endTime,
  });

  if (error) return Response.json({ alternatives: [], error }, { status: 502 });

  // Also return previously notified alerts for context
  const previousAlerts = await prisma.courtWatchAlert.findMany({
    where: { eventId: event.id },
    orderBy: { notifiedAt: "desc" },
    take: 20,
  });

  return Response.json({ alternatives, previousAlerts });
};

/** PUT: Enable/disable court watch config */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, params.id);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only event owner or admins can manage court watch." }, { status: 403 });
  }

  if (!event.latitude || !event.longitude) {
    return Response.json({ error: "Event must have coordinates to enable court watch." }, { status: 400 });
  }

  const body = await request.json();

  // body.enabled = false → disable
  if (body.enabled === false) {
    await prisma.event.update({ where: { id: params.id }, data: { courtWatchConfig: null } });
    return Response.json({ courtWatchConfig: null });
  }

  // Validate and store config
  const config: CourtWatchConfig = {
    radius: Number(body.radius) || 10000,
    indoor: body.indoor ?? null,
    surface: body.surface ?? null,
  };

  // Check limit of MAX_WATCHED_GAMES
  const watchedCount = await prisma.event.count({ where: { courtWatchConfig: { not: null }, id: { not: params.id } } });
  if (watchedCount >= 20) {
    return Response.json({ error: "Maximum of 20 games can be watched simultaneously." }, { status: 429 });
  }

  await prisma.event.update({ where: { id: params.id }, data: { courtWatchConfig: JSON.stringify(config) } });
  return Response.json({ courtWatchConfig: config });
};
