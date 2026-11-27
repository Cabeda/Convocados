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

/** True for the synthetic ledger ids minted by `systemUserId`. These are money
 *  identities, never accounts: name-based roster resolution must never pick one
 *  up, or the roster row becomes un-leavable by the human it names (the player
 *  is then on the list under an id their session can never match). */
export function isSystemUserId(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.startsWith("system:");
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

type LedgerDbClient = Pick<typeof prisma, "walletTransaction">;

/**
 * Move a player's ledger rows onto the account that now owns their roster row.
 * A claimed or merged identity inherits all history, money included (ADR 0026).
 *
 * The share/received/self-reported idempotency keys embed the userId, so the
 * row's owner and its key move together: leaving the key behind orphans the
 * debit (the new account reads 0) and lets the next sync post a second charge
 * under the new key. A key the target already owns wins, so a repeated claim
 * cannot duplicate a debt.
 */
export async function movePlayerLedger(
  client: LedgerDbClient,
  opts: { eventId: string; fromUserId: string; toUserId: string },
): Promise<void> {
  const { eventId, fromUserId, toUserId } = opts;
  if (!fromUserId || !toUserId || fromUserId === toUserId) return;

  const rows = await client.walletTransaction.findMany({
    where: { eventId, userId: fromUserId },
    select: { id: true, idempotencyKey: true },
  });
  if (rows.length === 0) return;

  const marker = `:${fromUserId}:`;
  for (const row of rows) {
    const nextKey = row.idempotencyKey?.includes(marker)
      ? row.idempotencyKey.split(marker).join(`:${toUserId}:`)
      : row.idempotencyKey;

    if (nextKey) {
      const existing = await client.walletTransaction.findUnique({
        where: { idempotencyKey: nextKey },
        select: { id: true },
      });
      if (existing && existing.id !== row.id) {
        await client.walletTransaction.delete({ where: { id: row.id } });
        continue;
      }
    }

    await client.walletTransaction.update({
      where: { id: row.id },
      data: {
        userId: toUserId,
        ...(nextKey !== row.idempotencyKey ? { idempotencyKey: nextKey } : {}),
      },
    });
  }
}
