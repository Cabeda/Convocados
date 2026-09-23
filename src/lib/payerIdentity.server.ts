/**
 * Payer identity — the single resolver for "which User id does this player's
 * money belong to". The ledger keys on a User id (schema requires it), but a
 * roster entry may be an anonymous, name-keyed player. This module is the one
 * place that rule lives: linked EventPlayer/Player account first, else a
 * deterministic synthetic system user.
 */
import { prisma } from "./db.server";
import { createLogger } from "./logger.server";

const log = createLogger("payer-identity");

/** The synthetic ledger user id for an unlinked player (schema requires a userId). */
export function systemUserId(eventId: string, playerName: string): string {
  return `system:${eventId}:${playerName}`;
}

type DbClient = Pick<typeof prisma, "eventPlayer" | "player" | "user">;

/**
 * Resolve the User id a player's money belongs to, or null when unlinked.
 * EventPlayer (ADR 0016 model) first, then the legacy Player table.
 */
export async function resolveLinkedUserId(
  eventId: string,
  playerName: string,
  client: DbClient = prisma,
): Promise<string | null> {
  const ep = await client.eventPlayer.findUnique({
    where: { eventId_name: { eventId, name: playerName } },
    select: { userId: true },
  });
  if (ep?.userId) return ep.userId;

  const player = await client.player.findFirst({
    where: { eventId, name: playerName },
    select: { userId: true },
  });
  return player?.userId ?? null;
}

/**
 * Ensure the synthetic system user exists for an unlinked player, returning its
 * id. Idempotent — the id is deterministic, so a repeat call is a no-op.
 */
export async function ensureSystemUserId(eventId: string, playerName: string, client: DbClient = prisma): Promise<string> {
  const id = systemUserId(eventId, playerName);
  const existing = await client.user.findUnique({ where: { id }, select: { id: true } });
  if (existing) return id;
  await client.user.create({
    data: { id, name: playerName, email: `${id}@system.local`, emailVerified: false },
  });
  log.info({ systemId: id }, "Created system user for unlinked player's ledger entry");
  return id;
}

/** The ledger userId for a player: their linked account, else a synthetic system user. */
export async function resolvePayerUserId(eventId: string, playerName: string): Promise<string> {
  const linked = await resolveLinkedUserId(eventId, playerName);
  return linked ?? (await ensureSystemUserId(eventId, playerName));
}
