import type { APIRoute } from "astro";
import { getUpcomingReminders, getPostGameReminders, markReminderSent } from "~/lib/reminders.server";
import { enqueueNotification, drainNotificationQueue } from "~/lib/notificationQueue.server";
import { cleanupStalePushTokens, sendPushToUser } from "~/lib/push.server";
import { sendReminder, sendPaymentReminder } from "~/lib/email.server";
import { getNotificationPrefs, wantsEmailReminder, wantsPaymentReminderEmail } from "~/lib/notificationPrefs.server";
import { getPlayersWithPendingPayments, shouldSendPaymentReminder, markPaymentReminderSent } from "~/lib/paymentReminders.server";
import { cleanupExpiredRateLimits } from "~/lib/apiRateLimit.server";
import { expireUnconfirmed } from "~/lib/priority.server";
import { expireOldCredits } from "~/lib/creditExpiry.server";
import {
  getEventsNeedingRsvpPing,
  getEventsNeedingRsvpSummary,
  getRsvpRecipients,
  getRsvpSummary,
  markRsvpCutoffSent,
} from "~/lib/rsvp.server";
import { createLogger } from "~/lib/logger.server";
import { prisma } from "~/lib/db.server";
import pLimit from "p-limit";

const log = createLogger("cron");

const CRON_SECRET = import.meta.env.CRON_SECRET ?? process.env.CRON_SECRET;
const APP_URL = import.meta.env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? "https://convocados.cabeda.dev";

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
          key: type === "24h" ? "notifyGameReminder24h" : type === "2h" ? "notifyGameReminder2h" : "notifyGameReminder1h",
          params: { title: r.eventTitle },
          url: `/events/${r.eventId}?action=rsvp`,
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

  // ── Payment nudge escalation (ADR 0018) ────────────────────────────────────
  // Replaces flat daily reminders with 3-stage escalation + organizer alert.
  let paymentEscalation = { stage1Sent: [] as string[], stage2Sent: [] as string[], stage3Sent: [] as string[], organizerAlerts: [] as string[] };
  try {
    const { processPaymentEscalation } = await import("~/lib/paymentNudgeEscalation.server");
    paymentEscalation = await processPaymentEscalation();
  } catch (err) {
    log.error({ err }, "Failed to process payment escalation");
  }

  // Legacy email reminders — still send email for users who want it (stage-agnostic)
  const paymentRemindersSent: string[] = [];
  try {
    const pendingPayments = await getPlayersWithPendingPayments();

    await Promise.allSettled(
      pendingPayments.map((pp) =>
        limit(async () => {
          try {
            const shouldSend = await shouldSendPaymentReminder(pp.eventId, pp.userId);
            if (!shouldSend) return;

            const prefs = await getNotificationPrefs(pp.userId);
            const wantsEmail = wantsPaymentReminderEmail(prefs);
            if (!wantsEmail) return;

            const eventUrl = `${APP_URL}/events/${pp.eventId}?action=pay`;
            await sendPaymentReminder(pp.email, {
              eventTitle: pp.eventTitle,
              amount: pp.amount.toFixed(2),
              currency: pp.currency,
              eventUrl,
            });
            await markPaymentReminderSent(pp.eventId, pp.userId);
            paymentRemindersSent.push(`${pp.email}:${pp.eventId}`);
          } catch (err) {
            log.error({ email: pp.email, eventId: pp.eventId, err }, "Failed to send payment reminder email");
          }
        }),
      ),
    );
  } catch (err) {
    log.error({ err }, "Failed to process payment reminder emails");
  }

  // ── Post-game reminders ───────────────────────────────────────────────────
  // Notify players after the game ends to add the score and settle payments
  const postGameRemindersSent: string[] = [];
  const postGameRemindersToMark: string[] = [];
  try {
    const postGameReminders = await getPostGameReminders();
    for (const r of postGameReminders) {
      try {
        // ADR 0017: Use recurring-aware message key for post-game notification
        const pgEvent = await prisma.event.findUnique({
          where: { id: r.eventId },
          select: { isRecurring: true },
        });
        const pgKey = pgEvent?.isRecurring ? "postGameNotificationRecurring" as const : "postGameNotification" as const;
        enqueueNotification(r.eventId, "post_game", {
          title: r.eventTitle,
          key: pgKey,
          params: { title: r.eventTitle },
          url: `/events/${r.eventId}?action=add-score`,
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

  // Expire old wallet credits (ADR 0008) — moves unspent Game Units into the
  // organizer's Extras Pot. Idempotent.
  let walletCreditsExpired = { expiredCount: 0, totalAmountExpiredCents: 0 };
  try {
    walletCreditsExpired = await expireOldCredits();
  } catch (err) {
    log.error({ err }, "Failed to expire old wallet credits");
  }

  // ── #457 RSVP 48h fanout + 24h organizer summary ──────────────────────────
  const rsvpPingsSent: string[] = [];
  const rsvpSummariesSent: string[] = [];
  // ADR 0017: Capture T-48h events BEFORE marking rsvpCutoffSent (shared with recruitment)
  const t48hEvents = await getEventsNeedingRsvpPing();
  try {
    for (const e of t48hEvents) {
      const recipientIds = await getRsvpRecipients(e.id);
      if (recipientIds.length === 0) {
        // nothing to ping — still mark sent so we don't re-check this event
        await markRsvpCutoffSent(e.id);
        continue;
      }

      // ADR 0018: Auto-confirm regulars and suppress their RSVP ping
      const { getAutoConfirmedUserIds, applyAutoConfirm } = await import("~/lib/autoConfirm.server");
      const autoConfirmed = await getAutoConfirmedUserIds(e.id);
      if (autoConfirmed.size > 0) {
        await applyAutoConfirm(e.id);
      }

      for (const userId of recipientIds) {
        // Skip RSVP ping for auto-confirmed users
        if (autoConfirmed.has(userId)) continue;
        try {
          await sendPushToUser(
            userId,
            e.title,
            `Are you coming to ${e.title}?`,
            `/events/${e.id}?action=rsvp`,
          );
          rsvpPingsSent.push(`${userId}:${e.id}`);
        } catch (err) {
          log.error({ userId, eventId: e.id, err }, "Failed to send RSVP ping");
        }
      }
      await markRsvpCutoffSent(e.id);
    }

    const summaryEvents = await getEventsNeedingRsvpSummary();
    for (const e of summaryEvents) {
      if (!e.ownerId) continue;
      const summary = await getRsvpSummary(e.id);
      // Skip if organizer is the only recipient (no point)
      const recipients = await getRsvpRecipients(e.id);
      if (recipients.length <= 1) continue;
      const title = e.title;
      const body = `${summary.yes} confirmed, ${summary.no} declined, ${summary.pending} pending`;
      try {
        await sendPushToUser(e.ownerId, `${title} — attendance check`, body, `/events/${e.id}`);
        rsvpSummariesSent.push(`${e.ownerId}:${e.id}`);
      } catch (err) {
        log.error({ eventId: e.id, err }, "Failed to send RSVP organizer summary push");
      }
    }
  } catch (err) {
    log.error({ err }, "Failed to process RSVP 48h/24h ticks");
  }

  // ── ADR 0017: Recruitment ping at T-48h for non-full games ─────────────────
  const recruitmentPingsSent: string[] = [];
  try {
    for (const e of t48hEvents) {
      const event = await prisma.event.findUnique({
        where: { id: e.id },
        select: { id: true, title: true, maxPlayers: true, recruitmentThreshold: true },
      });
      if (!event) continue;

      const activePlayers = await prisma.player.count({
        where: { eventId: event.id, archivedAt: null },
      });
      const spotsLeft = Math.max(0, event.maxPlayers - activePlayers);

      // Only send if game is NOT full (has spots remaining)
      if (spotsLeft === 0) continue;

      // Get active player userIds to exclude from recruitment
      const playerUsers = await prisma.player.findMany({
        where: { eventId: event.id, archivedAt: null, userId: { not: null } },
        select: { userId: true },
      });
      const playerUserIds = new Set(playerUsers.map((p) => p.userId as string));

      // Get followers who are NOT playing
      const follows = await prisma.eventFollow.findMany({
        where: { eventId: event.id, muteReminders: { not: true } },
        select: { userId: true },
      });
      const nonPlayingFollowers = follows.filter((f) => !playerUserIds.has(f.userId));

      if (nonPlayingFollowers.length > 0) {
        // Route through notification queue for locale-aware delivery + tier resolution
        await enqueueNotification(event.id, "recruitment", {
          title: event.title,
          key: "notifyRecruitment",
          params: { title: event.title },
          url: `/events/${event.id}?action=join`,
          spotsLeft,
        });
        recruitmentPingsSent.push(`${event.id}:${nonPlayingFollowers.length}`);
      }
    }
  } catch (err) {
    log.error({ err }, "Failed to process recruitment pings");
  }

  // ── ADR 0018: T-24h urgent recruitment + organizer share-sheet notification ─
  try {
    const summaryEventsForRecruitment = await getEventsNeedingRsvpSummary();
    for (const e of summaryEventsForRecruitment) {
      const event = await prisma.event.findUnique({
        where: { id: e.id },
        select: { id: true, title: true, maxPlayers: true, recruitmentThreshold: true, ownerId: true },
      });
      if (!event) continue;

      const activePlayers = await prisma.player.count({
        where: { eventId: event.id, archivedAt: null },
      });
      const spotsLeft = Math.max(0, event.maxPlayers - activePlayers);
      if (spotsLeft === 0) continue;

      // Urgent recruitment to non-playing followers
      await enqueueNotification(event.id, "recruitment", {
        title: event.title,
        key: "notifyRecruitmentUrgent",
        params: { title: event.title, n: String(spotsLeft) },
        url: `/events/${event.id}?action=join`,
        spotsLeft,
      });
      recruitmentPingsSent.push(`${event.id}:24h`);

      // Organizer share-sheet prompt
      if (event.ownerId) {
        await sendPushToUser(
          event.ownerId,
          event.title,
          `🔗 ${event.title} needs ${spotsLeft} more — share the invite link?`,
          `/events/${event.id}?action=share`,
        ).catch((err) => log.error({ err, eventId: event.id }, "Failed to send organizer share prompt"));
      }
    }
  } catch (err) {
    log.error({ err }, "Failed to process T-24h recruitment pings");
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

  // ── ADR 0018: Organizer daily digest ────────────────────────────────────────
  let digestsSent: string[] = [];
  try {
    const { processOrganizerDigests } = await import("~/lib/organizerDigest.server");
    const digestResult = await processOrganizerDigests();
    digestsSent = digestResult.sent;
  } catch (err) {
    log.error({ err }, "Failed to process organizer digests");
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
    JSON.stringify({ ok: true, sent, emailsSent, paymentRemindersSent, paymentEscalation, postGameRemindersSent, rateLimitsCleaned, priorityExpired, walletCreditsExpired, notificationJobsDrained, stalePushTokensCleaned, rsvpPingsSent, rsvpSummariesSent, recruitmentPingsSent, digestsSent }),
    { headers: { "Content-Type": "application/json" } },
  );
};
