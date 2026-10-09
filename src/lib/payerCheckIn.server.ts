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
 */
export async function processPayerCheckIns(): Promise<PayerCheckInResult> {
  const now = new Date();
  const result: PayerCheckInResult = { asked: [] };

  // Games with a payer set and at least one share still not paid.
  const games = await prisma.game.findMany({
    where: {
      payerEventPlayerId: { not: null },
      status: { not: "cancelled" },
      payments: { some: { status: { in: ["pending", "sent"] }, archivedAt: null } },
    },
    select: {
      id: true,
      eventId: true,
      dateTime: true,
      payerCheckInSentAt: true,
      payerCheckInSnoozedUntil: true,
      payerEventPlayer: { select: { userId: true } },
      event: { select: { title: true, durationMinutes: true } },
    },
  });

  for (const game of games) {
    // Game end = occurrence start + event duration.
    const gameEnd = new Date(game.dateTime.getTime() + game.event.durationMinutes * 60_000);
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

      await sendPushToUser(
        userId,
        game.event.title,
        `Has everyone paid for ${game.event.title}? Mark all paid, or ask again later.`,
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
