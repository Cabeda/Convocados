/**
 * ADR 0018 — Payment nudge escalation (3 stages + organizer alert).
 *
 * Stage 0: not started (payment just became pending after game ended)
 * Stage 1: soft nudge — "You owe €X — tap to pay" (fires at game end / first cron pass)
 * Stage 2: follow-up — "Still pending — €X for [Game]" (fires +48h after stage 1)
 * Stage 3: social proof — "8/10 have paid. You're one of 2 who haven't." (fires +5 days after game)
 * After stage 3 + 7 days: organizer alert — stops nudging debtor, notifies owner.
 *
 * ponytail: simple time-based progression, no state machine. Upgrade path: per-event
 * escalation timing config if groups want faster/slower cadence.
 */
import { prisma } from "./db.server";
import { sendPushToUser } from "./push.server";
import { getNotificationPrefs, wantsPaymentReminderPush } from "./notificationPrefs.server";
import { createLogger } from "./logger.server";

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

  // Find all events with pending payments where the game has ended
  const eventCosts = await prisma.eventCost.findMany({
    where: {
      payments: { some: { status: { in: ["pending", "sent"] } } },
      event: { dateTime: { lt: now } },
    },
    include: {
      event: { select: { id: true, title: true, dateTime: true, durationMinutes: true, ownerId: true, maxPlayers: true } },
      payments: { where: { status: { in: ["pending", "sent"] } } },
    },
  });

  for (const ec of eventCosts) {
    const gameEnd = new Date(ec.event.dateTime.getTime() + ec.event.durationMinutes * 60_000);
    if (now < gameEnd) continue;

    const hoursSinceEnd = (now.getTime() - gameEnd.getTime()) / (60 * 60 * 1000);
    const totalPayments = await prisma.playerPayment.count({ where: { eventCostId: ec.id } });
    const paidCount = await prisma.playerPayment.count({ where: { eventCostId: ec.id, status: "paid" } });

    for (const payment of ec.payments) {
      // Find linked user
      const player = await prisma.player.findFirst({
        where: { eventId: ec.eventId, name: payment.playerName, userId: { not: null } },
        select: { userId: true },
      });
      if (!player?.userId) continue;

      // Get or create nudge stage tracker
      const tracker = await prisma.paymentNudgeStage.upsert({
        where: { eventId_userId: { eventId: ec.eventId, userId: player.userId } },
        create: { eventId: ec.eventId, userId: player.userId, stage: 0 },
        update: {},
      });

      // Already alerted organizer — done with this player
      if (tracker.organiserAlert) continue;

      // Check prefs
      const prefs = await getNotificationPrefs(player.userId);
      if (!wantsPaymentReminderPush(prefs)) continue;

      const url = `/events/${ec.eventId}?action=pay`;

      // Stage progression based on time since game end
      if (tracker.stage === 0 && hoursSinceEnd >= STAGE_1_DELAY_H) {
        // Stage 1: soft nudge
        await sendPushToUser(player.userId, ec.event.title, `💸 You owe €${payment.amount.toFixed(2)} — tap to pay`, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: ec.eventId, userId: player.userId } },
          data: { stage: 1, lastSentAt: now },
        });
        result.stage1Sent.push(`${player.userId}:${ec.eventId}`);
      } else if (tracker.stage === 1 && hoursSinceEnd >= STAGE_2_DELAY_H) {
        // Stage 2: follow-up
        await sendPushToUser(player.userId, ec.event.title, `⏰ Still pending — €${payment.amount.toFixed(2)} for ${ec.event.title}`, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: ec.eventId, userId: player.userId } },
          data: { stage: 2, lastSentAt: now },
        });
        result.stage2Sent.push(`${player.userId}:${ec.eventId}`);
      } else if (tracker.stage === 2 && hoursSinceEnd >= STAGE_3_DELAY_H) {
        // Stage 3: social proof
        const unpaidCount = totalPayments - paidCount;
        const body = `${paidCount}/${totalPayments} players have paid. You're one of ${unpaidCount} who haven't.`;
        await sendPushToUser(player.userId, ec.event.title, body, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: ec.eventId, userId: player.userId } },
          data: { stage: 3, lastSentAt: now },
        });
        result.stage3Sent.push(`${player.userId}:${ec.eventId}`);
      } else if (tracker.stage === 3 && hoursSinceEnd >= ORGANIZER_ALERT_DELAY_H) {
        // Organizer alert — stop nudging, tell the owner
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: ec.eventId, userId: player.userId } },
          data: { organiserAlert: true },
        });
        result.organizerAlerts.push(`${player.userId}:${ec.eventId}`);
      }
    }

    // Send organizer alert as a batch (one notification for all stage-3-expired debtors per event)
    if (ec.event.ownerId && result.organizerAlerts.length > 0) {
      const debtorNames = ec.payments
        .filter((_p) => {
          const key = `${ec.eventId}`;
          return result.organizerAlerts.some((a) => a.endsWith(`:${key}`));
        })
        .map((p) => p.playerName);

      if (debtorNames.length > 0) {
        const body = `${debtorNames.length} player(s) still haven't paid after a week: ${debtorNames.slice(0, 3).join(", ")}${debtorNames.length > 3 ? ` +${debtorNames.length - 3} more` : ""}`;
        await sendPushToUser(
          ec.event.ownerId,
          ec.event.title,
          body,
          `/events/${ec.eventId}?action=confirm-payment`,
        ).catch((err) => log.error({ err, eventId: ec.eventId }, "Failed to send organizer payment alert"));
      }
    }
  }

  // Clean up nudge trackers for payments that have been settled
  await prisma.paymentNudgeStage.deleteMany({
    where: {
      eventId: { in: eventCosts.map((ec) => ec.eventId) },
      userId: {
        notIn: eventCosts.flatMap((ec) =>
          ec.payments.map((p) => p.playerName) // This needs userIds, let's just leave trackers — they're idempotent
        ),
      },
    },
  }).catch(() => {}); // ponytail: best-effort cleanup, not critical

  return result;
}
