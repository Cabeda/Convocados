import { prisma } from "./db.server";
import { findEndedEventsWithDebt } from "./paymentDebt.server";

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
 * Only fires after the game's own dateTime + duration has passed (not before the game),
 * so a recurring reset cannot hide the occurrence the group just played.
 * Only returns players linked to a user account (userId != null) with a verified email.
 */
export async function getPlayersWithPendingPayments(): Promise<PendingPaymentPlayer[]> {
  const events = await findEndedEventsWithDebt();
  if (events.length === 0) return [];

  const debts = events.flatMap((event) =>
    event.payments
      .filter((payment) => payment.status !== "paid" && payment.eventPlayer?.userId)
      .map((payment) => ({
        eventId: event.id,
        eventTitle: event.title,
        userId: payment.eventPlayer!.userId!,
        email: "",
        playerName: payment.playerName,
        amount: payment.amount,
        currency: event.currency,
      })),
  );

  const userIds = [...new Set(debts.map((d) => d.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, emailVerified: true },
  });
  const usersById = new Map(users.map((u) => [u.id, u]));

  return debts.flatMap((debt) => {
    const user = usersById.get(debt.userId);
    if (!user?.email || !user.emailVerified) return [];
    return [{ ...debt, email: user.email }];
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
