import type { APIRoute } from "astro";
import { getUpcomingReminders, markReminderSent } from "~/lib/reminders.server";
import { sendPushToEvent } from "~/lib/push.server";
import { sendReminder } from "~/lib/email.server";
import { getNotificationPrefs, wantsEmailReminder, wantsPushReminder } from "~/lib/notificationPrefs.server";
import { cleanupExpiredRateLimits } from "~/lib/apiRateLimit.server";
import { createLogger } from "~/lib/logger.server";

const log = createLogger("cron");

const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;

export const POST: APIRoute = async ({ request }) => {
  if (CRON_SECRET && request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sent: string[] = [];
  const emailsSent: string[] = [];

  for (const type of ["24h", "2h", "1h"] as const) {
    const reminders = await getUpcomingReminders(type);
    for (const r of reminders) {
      try {
        // Send push notifications (respecting per-user preferences)
        await sendPushToEvent(r.eventId, "Reminder", "notifyReminder" as any, { title: r.eventTitle }, `/events/${r.eventId}`, 0);
        sent.push(`${r.eventId}:${type}`);

        // Send email reminders to players who have accounts and want them
        const spotsLeft = r.players.length; // approximate — actual max not available here
        for (const player of r.players) {
          if (!player.userId || !player.email) continue;
          try {
            const prefs = await getNotificationPrefs(player.userId);
            if (wantsEmailReminder(prefs, type)) {
              await sendReminder(player.email, {
                eventTitle: r.eventTitle,
                dateTime: r.dateTime.toISOString(),
                location: r.location,
                spotsLeft,
                eventUrl: `${import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.fly.dev"}/events/${r.eventId}`,
                reminderType: type,
              });
              emailsSent.push(`${player.email}:${r.eventId}:${type}`);
            }
          } catch (err) {
            log.error({ email: player.email, eventId: r.eventId, type, err }, "Failed to send email reminder");
          }
        }

        await markReminderSent(r.eventId, type);
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

  return new Response(JSON.stringify({ ok: true, sent, emailsSent, rateLimitsCleaned }), {
    headers: { "Content-Type": "application/json" },
  });
};
