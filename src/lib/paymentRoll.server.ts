import { prisma } from "./db.server";

export interface PaymentRollEntry {
  playerName: string;
  amount: number;
  status: string;
  method: string | null;
}

/**
 * GamePayment-backed payment roll for one occurrence (ADR 0016).
 * Returns null when no Game exists for the occurrence — callers decide
 * whether to treat that as "no payments" or fall back to the frozen
 * GameHistory.paymentsSnapshot residue.
 *
 * `gameId` pins the live occurrence (its Game.dateTime can drift from
 * Event.dateTime after a datetime edit); otherwise match on dateTime.
 */
export async function occurrencePaymentRoll(
  eventId: string,
  dateTime: Date,
  gameId?: string | null,
): Promise<PaymentRollEntry[] | null> {
  const game = gameId
    ? await prisma.game.findFirst({
        where: { id: gameId, eventId },
        select: { id: true },
      })
    : await prisma.game.findFirst({
        where: { eventId, dateTime },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
  if (!game) return null;
  const rows = await prisma.gamePayment.findMany({
    where: { gameId: game.id, archivedAt: null },
    select: { playerName: true, amount: true, status: true, method: true },
  });
  return rows;
}

/** Player names on the occurrence's payment roll (empty when no Game). */
export async function occurrencePaymentNames(
  eventId: string,
  dateTime: Date,
  gameId?: string | null,
): Promise<string[]> {
  const roll = await occurrencePaymentRoll(eventId, dateTime, gameId);
  return (roll ?? []).map((r) => r.playerName);
}

/**
 * Payment rolls for every non-cancelled Game of the event, keyed by
 * occurrence dateTime (ISO). Newest games come first in `order`.
 */
export async function occurrencePaymentRolls(
  eventId: string,
): Promise<Array<{ dateTime: string; payments: PaymentRollEntry[] }>> {
  const games = await prisma.game.findMany({
    where: { eventId, status: { not: "cancelled" } },
    orderBy: { dateTime: "desc" },
    select: {
      dateTime: true,
      payments: {
        where: { archivedAt: null },
        select: { playerName: true, amount: true, status: true, method: true },
      },
    },
  });
  return games.map((g) => ({ dateTime: g.dateTime.toISOString(), payments: g.payments }));
}
