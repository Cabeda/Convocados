import { prisma } from "./db.server";

export interface EndedEventDebt {
  id: string;
  title: string;
  dateTime: Date;
  durationMinutes: number;
  ownerId: string | null;
  currentGameId: string;
  showDebtorNames: boolean;
  currency: string;
  payments: Array<{
    playerName: string;
    amount: number;
    status: string;
    eventPlayer: { userId: string | null } | null;
  }>;
}

/**
 * The one answer to "which ended occurrences still owe money" (ADR 0016):
 * Game rows, not Event.dateTime/currentGameId, because a recurring reset moves
 * both forward the moment a game ends. Debt is summed per linked debtor across
 * the Event's ended occurrences; cancelled Games, archived Events and paid
 * shares are excluded. Amounts are the Game's frozen shares (ADR 0019).
 */
export async function findEndedEventsWithDebt(now = new Date()): Promise<EndedEventDebt[]> {
  const games = await prisma.game.findMany({
    where: {
      status: { not: "cancelled" },
      event: { archivedAt: null },
      payments: { some: { status: { in: ["pending", "sent"] }, archivedAt: null } },
    },
    select: {
      id: true, eventId: true, dateTime: true, costCurrency: true,
      event: {
        select: {
          title: true, durationMinutes: true, ownerId: true, showDebtorNames: true,
          eventCost: { select: { currency: true } },
        },
      },
      payments: {
        where: { archivedAt: null },
        select: { playerName: true, amount: true, status: true, eventPlayer: { select: { userId: true } } },
      },
    },
    orderBy: { dateTime: "asc" },
  });

  type DebtPayment = EndedEventDebt["payments"][number];
  const byEvent = new Map<string, EndedEventDebt & { byUser: Map<string, DebtPayment> }>();
  for (const game of games) {
    const gameEnd = game.dateTime.getTime() + game.event.durationMinutes * 60_000;
    if (gameEnd > now.getTime()) continue;
    let event = byEvent.get(game.eventId);
    if (!event) {
      event = {
        id: game.eventId, title: game.event.title, dateTime: game.dateTime,
        durationMinutes: game.event.durationMinutes, ownerId: game.event.ownerId,
        currentGameId: game.id, showDebtorNames: game.event.showDebtorNames,
        currency: game.costCurrency ?? game.event.eventCost?.currency ?? "EUR",
        payments: [], byUser: new Map(),
      };
      byEvent.set(game.eventId, event);
    }
    for (const p of game.payments) {
      const userId = p.eventPlayer?.userId;
      if (!userId) {
        event.payments.push(p);
        continue;
      }
      const existing = event.byUser.get(userId);
      if (!existing) {
        const owed = p.status === "paid" ? 0 : p.amount;
        event.byUser.set(userId, { ...p, amount: owed, status: owed === 0 ? "paid" : "pending" });
      } else if (p.status !== "paid") {
        existing.status = "pending";
        existing.amount += p.amount;
      }
    }
  }
  return [...byEvent.values()].map(({ byUser, ...event }) => ({
    ...event,
    payments: [...event.payments, ...byUser.values()],
  }));
}
