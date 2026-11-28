/**
 * The one seam answering "which ended occurrences still owe money": ended,
 * non-cancelled Game rows on live Events with an unpaid share. A recurrence
 * reset moves Event.dateTime forward, so the Game dates the chase (ADR 0016).
 */
import { prisma } from "./db.server";

export type EndedOccurrence = {
  eventId: string; eventTitle: string; ownerId: string | null; showDebtorNames: boolean;
  gameId: string; gameEnd: Date; currency: string;
  payments: { status: string; amount: number; playerName: string; userId: string | null }[];
};

/** Ended, non-cancelled Game rows on live Events that still have an unpaid share. */
export async function findEndedPaymentOccurrences(now = new Date()): Promise<EndedOccurrence[]> {
  const games = await prisma.game.findMany({
    where: {
      dateTime: { lt: now },
      status: { not: "cancelled" },
      event: { archivedAt: null },
      payments: { some: { status: { in: ["pending", "sent"] }, archivedAt: null } },
    },
    select: {
      id: true,
      dateTime: true,
      costCurrency: true,
      event: {
        select: {
          id: true, title: true, ownerId: true, showDebtorNames: true, durationMinutes: true,
          eventCost: { select: { currency: true } },
        },
      },
      payments: {
        where: { archivedAt: null },
        select: { status: true, amount: true, playerName: true, eventPlayer: { select: { userId: true } } },
      },
    },
    orderBy: { dateTime: "asc" },
  });

  return games.flatMap((game) => {
    // The exact end (dateTime + duration) is checked here, where duration is known.
    const gameEnd = new Date(game.dateTime.getTime() + game.event.durationMinutes * 60_000);
    if (gameEnd > now) return [];
    return [{
      eventId: game.event.id,
      eventTitle: game.event.title,
      ownerId: game.event.ownerId,
      showDebtorNames: game.event.showDebtorNames,
      gameId: game.id,
      gameEnd,
      currency: game.costCurrency ?? game.event.eventCost?.currency ?? "EUR",
      payments: game.payments.map((p) => ({
        status: p.status, amount: p.amount, playerName: p.playerName, userId: p.eventPlayer?.userId ?? null,
      })),
    }];
  });
}
