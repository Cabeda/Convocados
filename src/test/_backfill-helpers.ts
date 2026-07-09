/**
 * Replicates the ensureEventPlayerForPlayer logic from scripts/wallet-backfill.ts
 * for use in tests, so we don't trigger the script's process.exit side effect.
 */
import { prisma } from "~/lib/db.server";

function ghostUserId(eventPlayerId: string): string {
  return `ghost:${eventPlayerId}`;
}
function ghostEmail(eventPlayerId: string): string {
  return `ghost-${eventPlayerId}@system.local`;
}

export async function ensureEventPlayerForPlayer(
  player: { id: string; eventId: string; name: string; userId: string | null },
): Promise<{ eventPlayerId: string; userId: string | null }> {
  const existing = await prisma.eventPlayer.findUnique({
    where: { eventId_name: { eventId: player.eventId, name: player.name } },
  });
  if (existing && existing.userId) {
    return { eventPlayerId: existing.id, userId: existing.userId };
  }
  if (existing && !existing.userId && player.userId) {
    await prisma.eventPlayer.update({
      where: { id: existing.id },
      data: { userId: player.userId },
    });
    return { eventPlayerId: existing.id, userId: player.userId };
  }
  if (existing && !existing.userId && !player.userId) {
    const userId = ghostUserId(existing.id);
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, name: player.name, email: ghostEmail(existing.id), emailVerified: false },
      update: {},
    });
    await prisma.eventPlayer.update({ where: { id: existing.id }, data: { userId } });
    return { eventPlayerId: existing.id, userId };
  }
  const created = await prisma.eventPlayer.create({
    data: { eventId: player.eventId, name: player.name },
  });
  if (player.userId) {
    await prisma.eventPlayer.update({ where: { id: created.id }, data: { userId: player.userId } });
    return { eventPlayerId: created.id, userId: player.userId };
  }
  const userId = ghostUserId(created.id);
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, name: player.name, email: ghostEmail(created.id), emailVerified: false },
    update: {},
  });
  await prisma.eventPlayer.update({ where: { id: created.id }, data: { userId } });
  return { eventPlayerId: created.id, userId };
}
