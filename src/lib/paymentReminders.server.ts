import { prisma } from "./db.server";
import { findEndedPaymentOccurrences } from "./paymentDebt.server";

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
 * Only fires after the game's dateTime + duration has passed (not before the game).
 * Only returns players linked to a user account (userId != null) with a verified email.
 */
export async function getPlayersWithPendingPayments(): Promise<PendingPaymentPlayer[]> {
  // One reminder per Event+user+currency: a per-Game currency override is
  // never summed into another currency's total.
  const debts = new Map<string, PendingPaymentPlayer>();
  for (const occurrence of await findEndedPaymentOccurrences()) {
    for (const payment of occurrence.payments) {
      if (payment.status !== "pending" || !payment.userId) continue;
      const key = `${occurrence.eventId}::${payment.userId}::${occurrence.currency}`;
      const debt = debts.get(key);
      if (debt) debt.amount += payment.amount;
      else debts.set(key, {
        eventId: occurrence.eventId, eventTitle: occurrence.eventTitle, userId: payment.userId,
        email: "", playerName: payment.playerName, amount: payment.amount, currency: occurrence.currency,
      });
    }
  }
  if (debts.size === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: [...debts.values()].map((d) => d.userId) }, emailVerified: true },
    select: { id: true, email: true },
  });
  const emails = new Map(users.map((user) => [user.id, user.email]));
  return [...debts.values()].flatMap((debt) => {
    const email = emails.get(debt.userId);
    return email ? [{ ...debt, email }] : [];
  });
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
