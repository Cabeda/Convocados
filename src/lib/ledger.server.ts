/**
 * The single write seam for the money ledger (ADR 0007).
 *
 * Every `WalletTransaction` row is posted here. The seam:
 * - classifies the entry through the reason registry (`src/lib/wallet.ts`),
 * - enforces idempotency when a key is supplied, so a payment provider's
 *   at-least-once webhook cannot double-post a charge (ADR 0038), and
 * - carries an external provider reference (`externalId`) for reconciliation.
 *
 * Callers still own the surrounding transaction/status projection; this module
 * only guarantees the ledger row is written once and is traceable.
 */
import { prisma, Prisma } from "./db.server";
import type { WalletTxDirection, WalletTxReason } from "./wallet";

export interface LedgerEntry {
  eventId: string;
  userId: string;
  amountCents: number;
  currency: string;
  direction: WalletTxDirection;
  reason: WalletTxReason;
  eventInstanceId?: string | null;
  subscriptionId?: string | null;
  extrasId?: string | null;
  statusAfter?: string | null;
  gameUnits?: number;
  markedById?: string | null;
  note?: string | null;
  /** Stable dedupe key. A repeated post with the same key is a no-op. */
  idempotencyKey?: string | null;
  /** Provider reference (e.g. a Stripe event or charge id). */
  externalId?: string | null;
}

export interface PostedLedgerEntry {
  id: string;
  /** True when an existing row with the same idempotency key was returned. */
  deduped: boolean;
}

type DbClient = Pick<typeof prisma, "walletTransaction">;

export async function postLedgerEntry(entry: LedgerEntry, client: DbClient = prisma): Promise<PostedLedgerEntry> {
  const data = {
    eventId: entry.eventId,
    userId: entry.userId,
    amountCents: Math.abs(Math.round(entry.amountCents)),
    currency: entry.currency,
    direction: entry.direction,
    gameUnits: entry.gameUnits ?? 0,
    reason: entry.reason,
    statusAfter: entry.statusAfter ?? null,
    eventInstanceId: entry.eventInstanceId ?? null,
    subscriptionId: entry.subscriptionId ?? null,
    extrasId: entry.extrasId ?? null,
    idempotencyKey: entry.idempotencyKey ?? null,
    externalId: entry.externalId ?? null,
    markedById: entry.markedById ?? null,
    note: entry.note ?? null,
  };

  try {
    const row = await client.walletTransaction.create({ data, select: { id: true } });
    return { id: row.id, deduped: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && entry.idempotencyKey) {
      const existing = await client.walletTransaction.findUnique({
        where: { idempotencyKey: entry.idempotencyKey },
        select: { id: true },
      });
      if (existing) return { id: existing.id, deduped: true };
    }
    throw e;
  }
}
