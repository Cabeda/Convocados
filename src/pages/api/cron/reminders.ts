import type { APIRoute } from "astro";
import { getUpcomingReminders, markReminderSent } from "~/lib/reminders.server";
import { sendPushToEvent } from "~/lib/push.server";
import { cleanupExpiredRateLimits } from "~/lib/apiRateLimit.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("cron");

const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;

export const POST: APIRoute = async ({ request }) => {
  if (CRON_SECRET && request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sent: string[] = [];
  for (const type of ["24h", "2h", "1h"] as const) {
    const reminders = await getUpcomingReminders(type);
    for (const r of reminders) {
      try {
        await sendPushToEvent(r.eventId, "Reminder", "notifyReminder" as any, { title: r.eventTitle }, `/events/${r.eventId}`, 0);
        await markReminderSent(r.eventId, type);
        sent.push(`${r.eventId}:${type}`);
      } catch (err) {
        log.error({ eventId: r.eventId, type, err }, "Failed to send reminder");
      }
    }
  }

  // Cleanup expired rate limit entries
  let rateLimitsCleaned = 0;
  try {
    rateLimitsCleaned = await cleanupExpiredRateLimits();
  } catch (err) {
    log.error({ err }, "Failed to cleanup expired rate limits");
  }

  return new Response(JSON.stringify({ ok: true, sent, rateLimitsCleaned }), {
    headers: { "Content-Type": "application/json" },
  });
};
