import { prisma } from "./db.server";

export interface PendingPaymentPlayer {
  eventId: string;
  eventTitle: string;
  userId: string;
  email: string;
  playerName: string;
  amount: number;
  currency: string;
}

/**
 * Find all authenticated players with pending payments for games that have been played.
 * Only returns players linked to a user account (userId != null) with a verified email.
 */
export async function getPlayersWithPendingPayments(): Promise<PendingPaymentPlayer[]> {
  // Find events that have at least one played game history AND have a cost set with pending payments
  const eventCosts = await prisma.eventCost.findMany({
    where: {
      payments: { some: { status: "pending" } },
      event: {
        history: { some: { status: "played" } },
      },
    },
    include: {
      event: { select: { id: true, title: true } },
      payments: {
        where: { status: "pending" },
      },
    },
  });

  const results: PendingPaymentPlayer[] = [];

  for (const ec of eventCosts) {
    for (const payment of ec.payments) {
      // Find the player record to get the userId
      const player = await prisma.player.findFirst({
        where: {
          eventId: ec.eventId,
          name: payment.playerName,
          userId: { not: null },
        },
        include: {
          user: { select: { email: true, emailVerified: true } },
        },
      });

      if (!player?.userId || !player.user?.email || !player.user.emailVerified) continue;

      results.push({
        eventId: ec.eventId,
        eventTitle: ec.event.title,
        userId: player.userId,
        email: player.user.email,
        playerName: payment.playerName,
        amount: payment.amount,
        currency: ec.currency,
      });
    }
  }

  return results;
}

/**
 * Check if a payment reminder should be sent (daily dedup).
 * Returns true if no reminder was sent today for this event+user combo.
 */
export async function shouldSendPaymentReminder(eventId: string, userId: string): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing = await prisma.paymentReminderLog.findFirst({
    where: {
      eventId,
      userId,
      sentAt: { gte: todayStart },
    },
  });

  return !existing;
}

/**
 * Mark a payment reminder as sent for deduplication.
 */
export async function markPaymentReminderSent(eventId: string, userId: string): Promise<void> {
  await prisma.paymentReminderLog.create({
    data: { eventId, userId },
  });
}
