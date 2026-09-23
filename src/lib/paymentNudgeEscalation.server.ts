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
 *
 * Debt discovery reads the occurrence Game's GamePayment roll (ADR 0016) —
 * the legacy EventCost/PlayerPayment join is gone (retarget: 5rhgs71k).
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

  // Events whose occurrence has ended and still has an occurrence Game —
  // unsettled rows are loaded from GamePayment in a second pass (Event has no
  // currentGame relation, only currentGameId).
  const candidateEvents = await prisma.event.findMany({
    where: {
      dateTime: { lt: now },
      currentGameId: { not: null },
    },
    select: {
      id: true,
      title: true,
      dateTime: true,
      durationMinutes: true,
      ownerId: true,
      currentGameId: true,
    },
  });
  const candidateGameIds = candidateEvents
    .map((e) => e.currentGameId)
    .filter((id): id is string => id !== null);
  const gamesById = new Map(
    (await prisma.game.findMany({
      where: {
        id: { in: candidateGameIds },
        status: { not: "cancelled" },
        payments: { some: { status: { in: ["pending", "sent"] }, archivedAt: null } },
      },
      select: {
        id: true,
        payments: {
          where: { archivedAt: null },
          select: {
            status: true,
            amount: true,
            playerName: true,
            eventPlayer: { select: { userId: true } },
          },
        },
      },
    })).map((g) => [g.id, g.payments] as const),
  );

  const openEvents = candidateEvents.filter(
    (e) => e.currentGameId !== null && gamesById.has(e.currentGameId),
  );

  for (const event of openEvents) {
    if (!event.currentGameId) continue;
    const gameEnd = new Date(event.dateTime.getTime() + event.durationMinutes * 60_000);
    if (now < gameEnd) continue;
    const hoursSinceEnd = (now.getTime() - gameEnd.getTime()) / (60 * 60 * 1000);
    const gamePayments = gamesById.get(event.currentGameId) ?? [];
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
      const userId = payment.eventPlayer?.userId;
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

      // Check prefs
      const prefs = await getNotificationPrefs(userId);
      if (!wantsPaymentReminderPush(prefs)) continue;

      const url = `/events/${event.id}?action=pay`;

      // Stage progression based on time since game end
      if (tracker.stage === 0 && hoursSinceEnd >= STAGE_1_DELAY_H) {
        // Stage 1: soft nudge
        await sendPushToUser(userId, event.title, `💸 You owe €${payment.amount.toFixed(2)} — tap to pay`, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: event.id, userId } },
          data: { stage: 1, lastSentAt: now },
        });
        result.stage1Sent.push(`${userId}:${event.id}`);
      } else if (tracker.stage === 1 && hoursSinceEnd >= STAGE_2_DELAY_H) {
        // Stage 2: follow-up
        await sendPushToUser(userId, event.title, `⏰ Still pending — €${payment.amount.toFixed(2)} for ${event.title}`, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: event.id, userId } },
          data: { stage: 2, lastSentAt: now },
        });
        result.stage2Sent.push(`${userId}:${event.id}`);
      } else if (tracker.stage === 2 && hoursSinceEnd >= STAGE_3_DELAY_H) {
        // Stage 3: social proof
        const unpaidCount = totalPayments - paidCount;
        const body = `${paidCount}/${totalPayments} players have paid. You're one of ${unpaidCount} who haven't.`;
        await sendPushToUser(userId, event.title, body, url);
        await prisma.paymentNudgeStage.update({
          where: { eventId_userId: { eventId: event.id, userId } },
          data: { stage: 3, lastSentAt: now },
        });
        result.stage3Sent.push(`${userId}:${event.id}`);
      } else if (tracker.stage === 3 && hoursSinceEnd >= ORGANIZER_ALERT_DELAY_H) {
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
  const trackedEventIds = await prisma.paymentNudgeStage
    .findMany({ select: { eventId: true } })
    .then((rows) => [...new Set(rows.map((r) => r.eventId))])
    .catch(() => [] as string[]);
  for (const eventId of trackedEventIds) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { currentGameId: true },
    }).catch(() => null);
    let stillOwing = false;
    if (event?.currentGameId) {
      stillOwing = (await prisma.gamePayment.count({
        where: { gameId: event.currentGameId, status: { in: ["pending", "sent"] }, archivedAt: null },
      }).catch(() => 0)) > 0;
    }
    if (!stillOwing) {
      await prisma.paymentNudgeStage.deleteMany({ where: { eventId } }).catch(() => {});
    }
  }

  return result;
}
