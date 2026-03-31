import type { APIRoute } from "astro";
import { getUpcomingReminders, markReminderSent } from "~/lib/reminders.server";
import { enqueueNotification, drainNotificationQueue } from "~/lib/notificationQueue.server";
import { sendReminder, sendPaymentReminder } from "~/lib/email.server";
import { getNotificationPrefs, wantsEmailReminder, wantsPaymentReminderEmail } from "~/lib/notificationPrefs.server";
import { getPlayersWithPendingPayments, shouldSendPaymentReminder, markPaymentReminderSent } from "~/lib/paymentReminders.server";
import { cleanupExpiredRateLimits } from "~/lib/apiRateLimit.server";
import { expireUnconfirmed } from "~/lib/priority.server";
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
        // Enqueue push notifications for this reminder
        enqueueNotification(r.eventId, "reminder", { title: r.eventTitle, key: "notifyGameFull" as any, params: { title: r.eventTitle }, url: `/events/${r.eventId}`, spotsLeft: 0 });
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

  // ── Payment reminders ─────────────────────────────────────────────────────
  const paymentRemindersSent: string[] = [];
  try {
    const pendingPayments = await getPlayersWithPendingPayments();
    const appUrl = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.fly.dev";

    for (const pp of pendingPayments) {
      try {
        const shouldSend = await shouldSendPaymentReminder(pp.eventId, pp.userId);
        if (!shouldSend) continue;

        const prefs = await getNotificationPrefs(pp.userId);
        if (!wantsPaymentReminderEmail(prefs)) continue;

        await sendPaymentReminder(pp.email, {
          eventTitle: pp.eventTitle,
          amount: pp.amount.toFixed(2),
          currency: pp.currency,
          eventUrl: `${appUrl}/events/${pp.eventId}`,
        });

        await markPaymentReminderSent(pp.eventId, pp.userId);
        paymentRemindersSent.push(`${pp.email}:${pp.eventId}`);
      } catch (err) {
        log.error({ email: pp.email, eventId: pp.eventId, err }, "Failed to send payment reminder");
      }
    }
  } catch (err) {
    log.error({ err }, "Failed to process payment reminders");
  }

  // Cleanup expired rate limit entries
  let rateLimitsCleaned = 0;
  try {
    rateLimitsCleaned = await cleanupExpiredRateLimits();
  } catch (err) {
    log.error({ err }, "Failed to cleanup expired rate limits");
  }

  // Expire unconfirmed priority spots past deadline
  let priorityExpired = 0;
  try {
    priorityExpired = await expireUnconfirmed();
  } catch (err) {
    log.error({ err }, "Failed to expire unconfirmed priority spots");
  }

  // Drain the notification job queue
  let notificationJobsDrained = 0;
  try {
    notificationJobsDrained = await drainNotificationQueue();
  } catch (err) {
    log.error({ err }, "Failed to drain notification queue");
  }

  return new Response(JSON.stringify({ ok: true, sent, emailsSent, paymentRemindersSent, rateLimitsCleaned, priorityExpired, notificationJobsDrained }), {
    headers: { "Content-Type": "application/json" },
  });
};
