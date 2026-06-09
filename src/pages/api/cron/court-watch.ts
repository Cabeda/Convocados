import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { searchCourtAlternatives, parseCourtWatchConfig } from "~/lib/courtAlternatives.server";
import { sendPushToUser } from "~/lib/push.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("court-watch");
const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
const MAX_WATCHED_GAMES = 20;
const APP_URL = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";

export const POST: APIRoute = async ({ request }) => {
  if (CRON_SECRET && request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Find all events with court watching enabled
  const events = await prisma.event.findMany({
    where: { courtWatchConfig: { not: null } },
    include: { admins: { select: { userId: true } } },
    take: MAX_WATCHED_GAMES,
  });

  const results: Array<{ eventId: string; found: number; error?: string }> = [];

  for (const event of events) {
    const config = parseCourtWatchConfig(event.courtWatchConfig);
    if (!config || !event.latitude || !event.longitude) {
      results.push({ eventId: event.id, found: 0, error: "invalid config or missing coordinates" });
      continue;
    }

    try {
      const { alternatives, error } = await searchCourtAlternatives({
        sport: event.sport,
        dateTime: event.dateTime,
        durationMinutes: event.durationMinutes,
        latitude: event.latitude,
        longitude: event.longitude,
        config,
      });

      if (error) {
        results.push({ eventId: event.id, found: 0, error });
        continue;
      }

      // Deduplicate: only keep alternatives not already notified
      let newCount = 0;
      for (const alt of alternatives) {
        const existing = await prisma.courtWatchAlert.findUnique({
          where: {
            eventId_tenantId_resourceId_slotDate_slotTime: {
              eventId: event.id,
              tenantId: alt.tenantId,
              resourceId: alt.resourceId,
              slotDate: alt.slotDate,
              slotTime: alt.slotTime,
            },
          },
        });

        if (existing) continue;

        // Store alert for dedup
        await prisma.courtWatchAlert.create({
          data: {
            eventId: event.id,
            tenantId: alt.tenantId,
            tenantName: alt.tenantName,
            resourceId: alt.resourceId,
            resourceName: alt.resourceName,
            slotTime: alt.slotTime,
            slotDate: alt.slotDate,
            duration: alt.duration,
            price: alt.price,
            currency: alt.currency,
            coordinate: alt.coordinate ? JSON.stringify(alt.coordinate) : null,
            address: alt.address,
          },
        });

        // Create in-app notification for owner + admins
        const recipientIds = [event.ownerId, ...event.admins.map((a) => a.userId)].filter(Boolean) as string[];
        const uniqueRecipients = [...new Set(recipientIds)];
        const title = event.title;
        const body = `🎾 ${alt.tenantName} — ${alt.resourceName} at ${alt.slotTime} (${alt.price}${alt.currency})`;
        const url = `/events/${event.id}`;

        for (const userId of uniqueRecipients) {
          await prisma.inAppNotification.create({
            data: { userId, eventId: event.id, type: "court_alternative_found", title, body, url },
          });
          await sendPushToUser(userId, title, body, `${APP_URL}${url}`);
        }

        newCount++;
      }

      results.push({ eventId: event.id, found: newCount });
    } catch (err) {
      log.error({ eventId: event.id, err }, "Failed to process court watch");
      results.push({ eventId: event.id, found: 0, error: String(err) });
    }
  }

  return Response.json({ ok: true, processed: events.length, results });
};
