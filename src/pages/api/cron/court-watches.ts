import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { findWatchMatches } from "~/lib/standaloneCourtWatch.server";
import { sendPushToUser } from "~/lib/push.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("court-watches");
const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
const APP_URL = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";
const LOOKAHEAD_DAYS = 14;

/** Process standalone recurring court watches and notify when a court frees up. */
export const POST: APIRoute = async ({ request }) => {
  if (CRON_SECRET && request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const watches = await prisma.courtWatch.findMany({ where: { active: true } });
  const results: Array<{ watchId: string; found: number; error?: string }> = [];

  for (const watch of watches) {
    try {
      const { matches, error } = await findWatchMatches(
        {
          sport: watch.sport,
          tenantId: watch.tenantId,
          resourceId: watch.resourceId,
          dayOfWeek: watch.dayOfWeek,
          startTime: watch.startTime,
          endTime: watch.endTime,
          durationMinutes: watch.durationMinutes,
          maxPrice: watch.maxPrice,
        },
        { lookaheadDays: LOOKAHEAD_DAYS },
      );

      if (error) {
        results.push({ watchId: watch.id, found: 0, error });
        continue;
      }

      let newCount = 0;
      for (const match of matches) {
        // Dedup: skip if we already notified this exact slot
        const existing = await prisma.courtWatchHit.findUnique({
          where: {
            watchId_resourceId_slotDate_slotTime: {
              watchId: watch.id,
              resourceId: match.resourceId,
              slotDate: match.slotDate,
              slotTime: match.slotTime,
            },
          },
        });
        if (existing) continue;

        await prisma.courtWatchHit.create({
          data: {
            watchId: watch.id,
            resourceId: match.resourceId,
            slotDate: match.slotDate,
            slotTime: match.slotTime,
          },
        });

        const priceLabel = match.price !== null && match.currency ? ` — ${match.price}${match.currency}` : "";
        const title = `🎾 Court available: ${watch.tenantName}`;
        const body = `${match.resourceName} on ${match.slotDate} at ${match.slotTime}${priceLabel}`;
        const url = `${APP_URL}/court-watches`;

        await prisma.inAppNotification.create({
          data: { userId: watch.userId, type: "court_watch_available", title, body, url: "/court-watches" },
        });
        await sendPushToUser(watch.userId, title, body, url);
        newCount++;
      }

      results.push({ watchId: watch.id, found: newCount });
    } catch (err) {
      log.error({ watchId: watch.id, err }, "Failed to process court watch");
      results.push({ watchId: watch.id, found: 0, error: String(err) });
    }
  }

  return Response.json({ ok: true, processed: watches.length, results });
};
