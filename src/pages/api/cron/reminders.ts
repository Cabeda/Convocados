import type { APIRoute } from "astro";
import { getUpcomingReminders, getPostGameReminders, markReminderSent } from "~/lib/reminders.server";
import { enqueueNotification, drainNotificationQueue } from "~/lib/notificationQueue.server";
import { cleanupStalePushTokens } from "~/lib/push.server";
import { sendReminder, sendPaymentReminder } from "~/lib/email.server";
import { getNotificationPrefs, wantsEmailReminder, wantsPaymentReminderEmail } from "~/lib/notificationPrefs.server";
import { getPlayersWithPendingPayments, shouldSendPaymentReminder, markPaymentReminderSent } from "~/lib/paymentReminders.server";
import { cleanupExpiredRateLimits } from "~/lib/apiRateLimit.server";
import { expireUnconfirmed } from "~/lib/priority.server";
import { createLogger } from "~/lib/logger.server";
import { prisma } from "~/lib/db.server";
import pLimit from "p-limit";

const log = createLogger("cron");

const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
const APP_URL = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.fly.dev";

/** Max concurrent outbound email sends to avoid overwhelming the SMTP provider */
const EMAIL_CONCURRENCY = 10;

export const POST: APIRoute = async ({ request }) => {
  if (CRON_SECRET && request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const limit = pLimit(EMAIL_CONCURRENCY);
  const sent: string[] = [];
  const emailsSent: string[] = [];

  // ── Game reminders ────────────────────────────────────────────────────────
  // Collect events to mark as sent after the queue is drained
  const remindersToMark: Array<{ eventId: string; type: "24h" | "2h" | "1h" }> = [];

  for (const type of ["24h", "2h", "1h"] as const) {
    const reminders = await getUpcomingReminders(type);
    for (const r of reminders) {
      try {
        // Enqueue push notification — drained at end of cron after emails are sent
        enqueueNotification(r.eventId, "reminder", {
          title: r.eventTitle,
          key: "notifyGameReminder",
          params: { title: r.eventTitle },
          url: `/events/${r.eventId}`,
          spotsLeft: 0,
          reminderType: type,
        });
        sent.push(`${r.eventId}:${type}`);
        remindersToMark.push({ eventId: r.eventId, type });

        // Batch-load prefs for all players with accounts in one query
        const userIds = r.players.map((p) => p.userId).filter(Boolean) as string[];
        const prefsRows = userIds.length > 0
          ? await prisma.notificationPreferences.findMany({ where: { userId: { in: userIds } } })
          : [];
        const prefsMap = new Map(prefsRows.map((p: { userId: string }) => [p.userId, p]));

        const spotsLeft = r.players.length;

        // Send emails concurrently (bounded by EMAIL_CONCURRENCY)
        await Promise.allSettled(
          r.players.map((player) =>
            limit(async () => {
              if (!player.userId || !player.email) return;
              try {
                const raw = prefsMap.get(player.userId);
                const prefs = await getNotificationPrefs(player.userId);
                // Use cached row if available, otherwise fall back to getNotificationPrefs
                const effective = raw ? { ...prefs, ...raw } : prefs;
                if (!wantsEmailReminder(effective, type)) return;
                await sendReminder(player.email, {
                  eventTitle: r.eventTitle,
                  dateTime: r.dateTime.toISOString(),
                  location: r.location,
                  spotsLeft,
                  eventUrl: `${APP_URL}/events/${r.eventId}`,
                  reminderType: type,
                });
                emailsSent.push(`${player.email}:${r.eventId}:${type}`);
              } catch (err) {
                log.error({ email: player.email, eventId: r.eventId, type, err }, "Failed to send email reminder");
              }
            }),
          ),
        );
      } catch (err) {
        log.error({ eventId: r.eventId, type, err }, "Failed to process reminder");
      }
    }
  }

  // ── Payment reminders ─────────────────────────────────────────────────────
  const paymentRemindersSent: string[] = [];
  try {
    const pendingPayments = await getPlayersWithPendingPayments();

    // Batch-load prefs for all users with pending payments
    const ppUserIds = [...new Set(pendingPayments.map((p) => p.userId))];
    const ppPrefsRows = ppUserIds.length > 0
      ? await prisma.notificationPreferences.findMany({ where: { userId: { in: ppUserIds } } })
      : [];
    const ppPrefsMap = new Map(ppPrefsRows.map((p: { userId: string }) => [p.userId, p]));

    await Promise.allSettled(
      pendingPayments.map((pp) =>
        limit(async () => {
          try {
            const shouldSend = await shouldSendPaymentReminder(pp.eventId, pp.userId);
            if (!shouldSend) return;

            const prefs = await getNotificationPrefs(pp.userId);
            const raw = ppPrefsMap.get(pp.userId);
            const effective = raw ? { ...prefs, ...raw } : prefs;
            if (!wantsPaymentReminderEmail(effective)) return;

            await sendPaymentReminder(pp.email, {
              eventTitle: pp.eventTitle,
              amount: pp.amount.toFixed(2),
              currency: pp.currency,
              eventUrl: `${APP_URL}/events/${pp.eventId}`,
            });

            await markPaymentReminderSent(pp.eventId, pp.userId);
            paymentRemindersSent.push(`${pp.email}:${pp.eventId}`);
          } catch (err) {
            log.error({ email: pp.email, eventId: pp.eventId, err }, "Failed to send payment reminder");
          }
        }),
      ),
    );
  } catch (err) {
    log.error({ err }, "Failed to process payment reminders");
  }

  // ── Post-game reminders ───────────────────────────────────────────────────
  // Notify players after the game ends to add the score and settle payments
  const postGameRemindersSent: string[] = [];
  const postGameRemindersToMark: string[] = [];
  try {
    const postGameReminders = await getPostGameReminders();
    for (const r of postGameReminders) {
      try {
        enqueueNotification(r.eventId, "post_game", {
          title: r.eventTitle,
          key: "postGameNotification",
          params: { title: r.eventTitle },
          url: `/events/${r.eventId}`,
          spotsLeft: 0,
        });
        postGameRemindersSent.push(r.eventId);
        postGameRemindersToMark.push(r.eventId);
      } catch (err) {
        log.error({ eventId: r.eventId, err }, "Failed to process post-game reminder");
      }
    }
  } catch (err) {
    log.error({ err }, "Failed to process post-game reminders");
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

  // Drain the notification job queue — must happen before marking reminders sent
  // so that if the cron is killed mid-run, reminders are not marked sent without push delivery
  let notificationJobsDrained = 0;
  try {
    notificationJobsDrained = await drainNotificationQueue();
  } catch (err) {
    log.error({ err }, "Failed to drain notification queue");
  }

  // Clean up stale push tokens (90+ days old)
  let stalePushTokensCleaned = { appTokens: 0, webSubs: 0 };
  try {
    stalePushTokensCleaned = await cleanupStalePushTokens();
  } catch (err) {
    log.error({ err }, "Failed to clean up stale push tokens");
  }

  // Mark reminders as sent only after push delivery is complete
  await Promise.allSettled([
    ...remindersToMark.map(({ eventId, type }) =>
      markReminderSent(eventId, type).catch((err) =>
        log.error({ eventId, type, err }, "Failed to mark reminder sent"),
      ),
    ),
    ...postGameRemindersToMark.map((eventId) =>
      markReminderSent(eventId, "post-game").catch((err) =>
        log.error({ eventId, type: "post-game", err }, "Failed to mark post-game reminder sent"),
      ),
    ),
  ]);

  return new Response(
    JSON.stringify({ ok: true, sent, emailsSent, paymentRemindersSent, postGameRemindersSent, rateLimitsCleaned, priorityExpired, notificationJobsDrained, stalePushTokensCleaned }),
    { headers: { "Content-Type": "application/json" } },
  );
};
