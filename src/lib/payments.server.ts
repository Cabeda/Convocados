import { prisma } from "./db.server";

/**
 * Recalculate payment shares for an event after player changes.
 * If no EventCost exists, this is a no-op.
 * Preserves existing payment statuses (paid/exempt/pending).
 */
export async function syncPaymentsForEvent(eventId: string): Promise<void> {
  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!eventCost) return;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) return;

  const activePlayers = event.players.slice(0, event.maxPlayers);
  const share = activePlayers.length > 0 ? eventCost.totalAmount / activePlayers.length : 0;

  // Upsert payment for each active player (preserves status)
  for (const player of activePlayers) {
    await prisma.playerPayment.upsert({
      where: {
        eventCostId_playerName: { eventCostId: eventCost.id, playerName: player.name },
      },
      create: {
        eventCostId: eventCost.id,
        playerName: player.name,
        amount: share,
      },
      update: {
        amount: share,
      },
    });
  }

  // Remove payments for players no longer active
  const activeNames = new Set(activePlayers.map((p) => p.name));
  await prisma.playerPayment.deleteMany({
    where: {
      eventCostId: eventCost.id,
      playerName: { notIn: [...activeNames] },
    },
  });
}
