/**
 * ADR 0018 — Payment nudge escalation (3 stages + organizer alert).
 *
 * Stage 0: not started (payment just became pending after game ended)
 * Stage 1: soft nudge — "You owe 5.00€ — tap to pay" (fires at game end / first cron pass)
 * Stage 2: follow-up — "Still pending — 5.00€ for [Game]" (fires +48h after stage 1)
 * Stage 3: social proof — "8/10 have paid. You're one of 2 who haven't." (fires +5 days after game)
 * After stage 3 + 7 days: organizer alert — stops nudging debtor, notifies owner.
 *
 * ponytail: simple time-based progression, no state machine. Upgrade path: per-event
 * escalation timing config if groups want faster/slower cadence.
 *
 * Debt discovery reads ended occurrence Games through paymentDebt.server.ts:
 * a recurrence reset moves Event.dateTime forward, so it cannot date the chase.
 */
import { prisma } from "./db.server";
import { sendPushToUser } from "./push.server";
import { getNotificationPrefs, wantsPaymentReminderPush } from "./notificationPrefs.server";
import { findEndedPaymentOccurrences } from "./paymentDebt.server";
import { fireWebhooks } from "./webhook.server";
import { resolvePaymentDetails } from "./paymentDetailsResolve.server";
import { createLogger } from "./logger.server";
import { formatMoney, toCents } from "./money";

const log = createLogger("payment-nudge");

/** Timing: hours after game end for each stage transition */
const STAGE_1_DELAY_H = 0;    // immediately after game (post-game cron fires it)
const STAGE_2_DELAY_H = 48;   // +48h after stage 1
const STAGE_3_DELAY_H = 120;  // +5 days after game end
const ORGANIZER_ALERT_DELAY_H = 168; // +7 days after game end

export interface EscalationResult {
  stage1Sent: string[];
  stage2Sent: string[];
  stage3Sent: string[];
  organizerAlerts: string[];
}

/**
 * Process all pending payment nudge escalations.
 * Called from the cron endpoint.
 */
export async function processPaymentEscalation(): Promise<EscalationResult> {
  const now = new Date();
  const result: EscalationResult = { stage1Sent: [], stage2Sent: [], stage3Sent: [], organizerAlerts: [] };

  const openEvents = await findEndedPaymentOccurrences(now);

  for (const occurrence of openEvents) {
    const event = { ...occurrence, id: occurrence.eventId, title: occurrence.eventTitle, currentGameId: occurrence.gameId };
    const hoursSinceEnd = (now.getTime() - event.gameEnd.getTime()) / (60 * 60 * 1000);
    const gamePayments = event.payments;
    // Per-Game override → EventCost template → EUR (settlement's rule).
    const currency = event.currency;
    // Where the money goes, resolved once per event (ADR 0055) so every nudge
    // in this run names the same account the announcement did.
    const { methods: paymentMethods } = await resolvePaymentDetails(event.id, event.currentGameId);
    const totalPayments = gamePayments.length;
    const paidCount = gamePayments.filter((p) => p.status === "paid").length;

    // Users with a still-unsettled payment on this event. Trackers for anyone
    // else (paid since the last tick) are stale and removed below so a future
    // debt starts cleanly at stage 0.
    const activeUserIds = new Set<string>();
    const eventDebtorNames: string[] = [];
    const eventOrganizerAlerts: string[] = [];

    for (const payment of gamePayments) {
      if (payment.status === "paid") continue;
      const userId = payment.userId;
      if (!userId) continue;
      activeUserIds.add(userId);

      // Get or create nudge stage tracker
      const tracker = await prisma.paymentNudgeStage.upsert({
        where: { eventId_userId: { eventId: event.id, userId } },
        create: { eventId: event.id, userId, stage: 0 },
        update: {},
      });

      // Already alerted organizer — done with this player
      if (tracker.organiserAlert) continue;

      // Paced by the previous send: an old occurrence elsewhere on the Event
      // must not advance a fresh debt one stage per 5-minute tick.
      const hoursSinceLastSent = tracker.lastSentAt
        ? (now.getTime() - tracker.lastSentAt.getTime()) / (60 * 60 * 1000)
        : Number.POSITIVE_INFINITY;

      // Prefs gate the push only — the escalation stage, the webhook fact and
      // the organizer alert are domain facts and run regardless of the
      // debtor's channel choices (ADR 0051).
      const prefs = await getNotificationPrefs(userId);
      const wantsPush = wantsPaymentReminderPush(prefs);

      const url = `/events/${event.id}?action=pay`;

      // Lean webhook fact per nudge; names only when showDebtorNames (group
      // privacy is domain policy, not a client concern).
      const fireNudgeWebhook = (stage: 1 | 2 | 3) =>
        fireWebhooks(event.id, "payment_nudge", {
          stage,
          amountCents: Math.round(payment.amount * 100),
          currency,
          // Absent, not empty, when nothing is known: a subscriber must never
          // render "pay via []" for an event nobody configured.
          ...(paymentMethods.length > 0 ? { paymentMethods } : {}),
          ...(event.showDebtorNames ? { playerName: payment.playerName } : {}),
        }).catch(() => {});

      // Stage progression based on time since game end
      if (tracker.stage === 0 && hoursSinceEnd >= STAGE_1_DELAY_H) {
        // Stage 1: soft nudge
        if (wantsPush) await sendPushToUser(userId, event.title, `💸 You owe ${formatMoney(toCents(payment.amount), currency)} — tap to pay`, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: event.id, userId } },
          data: { stage: 1, lastSentAt: now },
        });
        result.stage1Sent.push(`${userId}:${event.id}`);
        fireNudgeWebhook(1);
      } else if (tracker.stage === 1 && hoursSinceEnd >= STAGE_2_DELAY_H && hoursSinceLastSent >= STAGE_2_DELAY_H) {
        // Stage 2: follow-up
        if (wantsPush) await sendPushToUser(userId, event.title, `⏰ Still pending — ${formatMoney(toCents(payment.amount), currency)} for ${event.title}`, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: event.id, userId } },
          data: { stage: 2, lastSentAt: now },
        });
        result.stage2Sent.push(`${userId}:${event.id}`);
        fireNudgeWebhook(2);
      } else if (tracker.stage === 2 && hoursSinceEnd >= STAGE_3_DELAY_H && hoursSinceLastSent >= STAGE_3_DELAY_H - STAGE_2_DELAY_H) {
        // Stage 3: social proof
        const unpaidCount = totalPayments - paidCount;
        const body = `${paidCount}/${totalPayments} players have paid. You're one of ${unpaidCount} who haven't.`;
        if (wantsPush) await sendPushToUser(userId, event.title, body, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: event.id, userId } },
          data: { stage: 3, lastSentAt: now },
        });
        result.stage3Sent.push(`${userId}:${event.id}`);
        fireNudgeWebhook(3);
      } else if (tracker.stage === 3 && hoursSinceEnd >= ORGANIZER_ALERT_DELAY_H && hoursSinceLastSent >= ORGANIZER_ALERT_DELAY_H - STAGE_3_DELAY_H) {
        // Organizer alert — stop nudging, tell the owner
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: event.id, userId } },
          data: { organiserAlert: true },
        });
        result.organizerAlerts.push(`${userId}:${event.id}`);
        eventOrganizerAlerts.push(`${userId}:${event.id}`);
        eventDebtorNames.push(payment.playerName);
      }
    }

    // Drop trackers for users with no remaining unsettled payment on this
    // event (they paid since the last tick). Scoped to linked userIds seen
    // above — never compare userId against playerName (different domains).
    // Empty active set means no linked user still owes: clear all trackers.
    await prisma.paymentNudgeStage.deleteMany({
      where: activeUserIds.size > 0
        ? { eventId: event.id, userId: { notIn: [...activeUserIds] } }
        : { eventId: event.id },
    }).catch(() => {}); // ponytail: best-effort cleanup, not critical

    // Fire payment_organizer_alert webhook (non-blocking) — the escalation
    // fact exists regardless of who receives the push.
    if (eventOrganizerAlerts.length > 0 && eventDebtorNames.length > 0) {
      fireWebhooks(event.id, "payment_organizer_alert", {
        unpaidCount: eventDebtorNames.length,
        ...(event.showDebtorNames ? { unpaidNames: eventDebtorNames } : {}),
      }).catch(() => {});
    }

    // Send organizer alert as a batch (one notification for all stage-3-expired debtors per event)
    if (event.ownerId && eventOrganizerAlerts.length > 0 && eventDebtorNames.length > 0) {
      const body = `${eventDebtorNames.length} player(s) still haven't paid after a week: ${eventDebtorNames.slice(0, 3).join(", ")}${eventDebtorNames.length > 3 ? ` +${eventDebtorNames.length - 3} more` : ""}`;
      await sendPushToUser(
        event.ownerId,
        event.title,
        body,
        `/events/${event.id}?action=confirm-payment`,
      ).catch((err) => log.error({ err, eventId: event.id }, "Failed to send organizer payment alert"));
    }
  }

  // Sweep trackers for events with no remaining unsettled payment at all.
  // Such events never enter the loop above, so without this their trackers
  // would linger after the debt is fully settled.
  const activeEventIds = new Set(openEvents.map((o) => o.eventId));
  const trackedEventIds = await prisma.paymentNudgeStage
    .findMany({ select: { eventId: true } })
    .then((rows) => [...new Set(rows.map((r) => r.eventId))])
    .catch(() => [] as string[]);
  for (const eventId of trackedEventIds) {
    if (!activeEventIds.has(eventId)) {
      await prisma.paymentNudgeStage.deleteMany({ where: { eventId } }).catch(() => {});
    }
  }

  return result;
}
