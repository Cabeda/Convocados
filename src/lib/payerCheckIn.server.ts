/**
 * #1236 — Payer check-in: 24h after a game, if the payer is set and not
 * everyone has paid, ask the payer one question: "did everyone pay?"
 *
 * The push carries the gameId so Android can render two quick actions —
 * "Mark all paid" (POST .../payer-check-in/mark-all-paid) and "Ask again in
 * 24h" (POST .../payer-check-in/snooze). On web the same push opens the
 * event page, where the existing settlement UI answers it.
 *
 * ponytail: one ask per game, re-armed only by an explicit snooze. No
 * repeat-until-paid loop — an unanswered check-in stays quiet instead of
 * nagging daily. Upgrade path: a per-event cadence if groups ask for one.
 */
import { prisma } from "./db.server";
import { sendPushToUser } from "./push.server";
import { getNotificationPrefs, wantsPaymentReminderPush } from "./notificationPrefs.server";
import { createLogger } from "./logger.server";
import { createT, type Locale } from "./i18n";

const log = createLogger("payer-check-in");

/** Hours after game end before the first check-in ask */
export const CHECK_IN_DELAY_H = 24;

/** Snooze window: tapping "ask again in 24h" suppresses the next ask this long */
export const SNOOZE_HOURS = 24;

export interface PayerCheckInResult {
  /** `${eventId}:${gameId}` of every game the payer was asked about */
  asked: string[];
}

/**
 * Process all games that owe the payer a check-in.
 * Called from the cron endpoint.
 *
 * Scoped per-game, not per-event: the trigger is the occurrence's own
 * `game.dateTime` plus the event duration. The event's `dateTime` is
 * useless here — a recurring reset (advanceOccurrence.server.ts) moves it
 * forward to the next occurrence the moment a game ends, so gating on it
 * would silence every recurring event, which is the primary scenario.
 *
 * Idempotence is per game: `payerCheckInSentAt` records the ask and only an
 * explicit snooze re-arms it, so closed occurrences left behind by a reset
 * are each asked about exactly once.
 */
export async function processPayerCheckIns(): Promise<PayerCheckInResult> {
  const now = new Date();
  const result: PayerCheckInResult = { asked: [] };

  // Safe pre-filter: the game ends at `game.dateTime + duration`, and duration
  // is non-negative, so a due game's dateTime is always ≥24h in the past. The
  // exact +24h gate is computed below, where the duration is known.
  const games = await prisma.game.findMany({
    where: {
      dateTime: { lt: new Date(now.getTime() - CHECK_IN_DELAY_H * 60 * 60 * 1000) },
      payerEventPlayerId: { not: null },
      status: { not: "cancelled" },
      event: { archivedAt: null },
      payments: { some: { status: { in: ["pending", "sent"] }, archivedAt: null } },
    },
    select: {
      id: true,
      eventId: true,
      dateTime: true,
      payerCheckInSentAt: true,
      payerCheckInSnoozedUntil: true,
      event: { select: { title: true, durationMinutes: true } },
      payerEventPlayer: { select: { userId: true } },
    },
  });

  for (const game of games) {
    const { event } = game;

    // Game end = occurrence start + event duration.
    const gameEnd = new Date(game.dateTime.getTime() + event.durationMinutes * 60_000);
    const hoursSinceEnd = (now.getTime() - gameEnd.getTime()) / (60 * 60 * 1000);
    if (hoursSinceEnd < CHECK_IN_DELAY_H) continue;

    // Snoozed: the payer explicitly asked to be asked again later.
    if (game.payerCheckInSnoozedUntil && now < game.payerCheckInSnoozedUntil) continue;

    // Already asked and never snoozed since — stay quiet (no daily nagging).
    if (game.payerCheckInSentAt && !game.payerCheckInSnoozedUntil) continue;

    const userId = game.payerEventPlayer?.userId;
    if (!userId) continue; // payer not linked to an account — nobody to ask

    try {
      const prefs = await getNotificationPrefs(userId);
      if (!wantsPaymentReminderPush(prefs)) continue;

      // Localized like the other server pushes: the payer's device locale,
      // falling back to English when they have no registered device.
      const [appTokens, webSubs] = await Promise.all([
        prisma.appPushToken.findMany({ where: { userId }, select: { locale: true } }),
        prisma.pushSubscription.findMany({ where: { userId }, select: { locale: true } }),
      ]);
      const locale: Locale = (appTokens[0]?.locale ?? webSubs[0]?.locale ?? "en") as Locale;
      const t = createT(locale);

      await sendPushToUser(
        userId,
        event.title,
        t("notifyPayerCheckIn", { title: event.title }),
        `/events/${game.eventId}`,
        { type: "payment_payer_check_in", gameId: game.id },
      );

      // Mark after send so a failed push retries on the next tick. Clear the
      // snooze marker — it has been honoured.
      await prisma.game.update({
        where: { id: game.id },
        data: { payerCheckInSentAt: now, payerCheckInSnoozedUntil: null },
      });
      result.asked.push(`${game.eventId}:${game.id}`);
    } catch (err) {
      log.error({ err, gameId: game.id, eventId: game.eventId }, "Failed to send payer check-in");
    }
  }

  return result;
}
