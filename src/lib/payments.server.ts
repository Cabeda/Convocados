/**
 * Payment recording — writes to the per-Event `WalletTransaction` ledger
 * (ADR 0007, ADR 0019). The legacy `PlayerPayment` table is no longer
 * written by this code path; reads are feature-flagged in
 * `balance.server.ts` so a rollback just flips the env var.
 *
 * ADR 0007 — Wallet ledger is the single source of truth for money.
 * ADR 0008 — Monthly subscriptions cover non-cancelled Event instances in
 *             their Subscription Window; missed games earn 1 Game Unit.
 * ADR 0019 — Historical Settlement via `gameHistoryId` lets an Owner/Admin
 *             mark a frozen GameHistory.paymentsSnapshot entry as paid
 *             without mutating the snapshot.
 *
 * This file is `.server.ts` (not pure) — it talks to Prisma.
 */

import { prisma } from "./db.server";
import { computeAvailableUnits, type WalletTx } from "./wallet";
import {
  activeSubscriptionCoversDate,
  subscriptionWindowFor,
} from "./monthly";
import { createLogger } from "./logger.server";

const log = createLogger("payments");

export type PlayerPaymentMode = "monthly" | "per_game";

export interface RecordPerGameShareArgs {
  eventId: string;
  playerName: string;
  userId: string | null;
  eventInstanceDate: Date;
}

export interface RecordPerGameShareResult {
  mode: PlayerPaymentMode;
  amountCents: number;
  netPlayerPaymentCents: number;
  creditRedeemed: number;
  playerPaymentId: string;
  subscriptionId: string | null;
}

/**
 * Find the active MonthlySubscription for this (event, user, instance date),
 * if any.
 */
async function findActiveSubscription(
  eventId: string,
  userId: string,
  eventInstanceDate: Date,
) {
  if (!userId) return null;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { timezone: true },
  });
  if (!event) return null;
  const window = subscriptionWindowFor(eventInstanceDate, event.timezone || "UTC");
  const sub = await prisma.monthlySubscription.findUnique({
    where: {
      eventId_userId_windowStart: { eventId, userId, windowStart: window.windowStart },
    },
  });
  if (!sub) return null;
  return activeSubscriptionCoversDate(sub, eventInstanceDate) ? sub : null;
}

async function findPlayerByName(eventId: string, playerName: string) {
  return prisma.player.findFirst({ where: { eventId, name: playerName } });
}

async function findEventCost(eventId: string) {
  return prisma.eventCost.findUnique({ where: { eventId } });
}

async function readLedgerForUser(eventId: string, userId: string): Promise<WalletTx[]> {
  const rows = await prisma.walletTransaction.findMany({
    where: { eventId, userId },
    select: {
      direction: true,
      reason: true,
      gameUnits: true,
      amountCents: true,
      createdAt: true,
      eventInstanceId: true,
      idempotencyKey: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    direction: r.direction as WalletTx["direction"],
    reason: r.reason as WalletTx["reason"],
    gameUnits: r.gameUnits,
    amountCents: r.amountCents,
    createdAt: r.createdAt,
    eventInstanceId: r.eventInstanceId,
    idempotencyKey: r.idempotencyKey,
  }));
}

/**
 * Record that `playerName` is participating in the Event instance at
 * `eventInstanceDate`. Writes the appropriate ledger rows and updates the
 * PlayerPayment row.
 */
export async function recordPerGameShare(
  args: RecordPerGameShareArgs,
): Promise<RecordPerGameShareResult> {
  const { eventId, playerName, userId, eventInstanceDate } = args;

  const eventCost = await findEventCost(eventId);
  if (!eventCost) {
    throw new Error(`No EventCost for event ${eventId}`);
  }

  // Per-game share in cents (rounded to whole cents).
  const maxPlayers = (await prisma.event.findUnique({
    where: { id: eventId },
    select: { maxPlayers: true },
  }))?.maxPlayers ?? 1;
  const baseShareCents = Math.round((eventCost.totalAmount / maxPlayers) * 100);

  // 1. Is there an active subscription that covers this date?
  const subscription = userId
    ? await findActiveSubscription(eventId, userId, eventInstanceDate)
    : null;

  // Look up the player to know the canonical id (and so PlayerPayment upsert
  // can match on eventCostId+playerName).
  const player = await findPlayerByName(eventId, playerName);

  if (subscription) {
    // Monthly-covered. Per OI-1: no per-attendance ledger rows.
    // Per OI-2: zero-amount paid PlayerPayment row (kept for backwards compat
    // — the chip UI is gone, but external code and the legacy read path
    // still expect the row).
    const upserted = await prisma.playerPayment.upsert({
      where: {
        eventCostId_playerName: { eventCostId: eventCost.id, playerName },
      },
      create: {
        eventCostId: eventCost.id,
        playerName,
        amount: 0,
        status: "paid",
        paidAt: new Date(),
      },
      update: {
        amount: 0,
        status: "paid",
        paidAt: new Date(),
      },
    });
    return {
      mode: "monthly",
      amountCents: 0,
      netPlayerPaymentCents: 0,
      creditRedeemed: 0,
      playerPaymentId: upserted.id,
      subscriptionId: subscription.id,
    };
  }

  // 2. Plain per-game. Apply drop-in surcharge if not monthly.
  const isMonthlySubscriberThisMonth = false; // we already checked above
  const surchargeCents = isMonthlySubscriberThisMonth
    ? 0
    : eventCost.dropInSurchargeCents;
  const amountCents = baseShareCents + surchargeCents;

  // 3. Is there wallet credit available?
  const ledger = userId ? await readLedgerForUser(eventId, userId) : [];
  const availableUnits = computeAvailableUnits(ledger);
  const canRedeem = availableUnits > 0;
  const creditRedeemed = canRedeem ? 1 : 0;
  const netPlayerPaymentCents = canRedeem ? 0 : amountCents;

  // 4. Write the per_game_share debit (always — this is the gross).
  const debit = await prisma.walletTransaction.create({
    data: {
      eventId,
      userId: userId ?? (await ensureSystemUserId(eventId, playerName, player?.userId ?? null)),
      amountCents,
      currency: eventCost.currency,
      direction: "debit",
      gameUnits: 0,
      reason: "per_game_share",
      eventInstanceId: eventId,
    },
  });

  // 5. If credit was redeemed, write the credit_redeemed row.
  if (canRedeem) {
    await prisma.walletTransaction.create({
      data: {
        eventId,
        userId: debit.userId,
        amountCents: 0,
        currency: eventCost.currency,
        direction: "credit",
        gameUnits: -1,
        reason: "credit_redeemed",
        eventInstanceId: eventId,
      },
    });
  }

  // 6. Upsert PlayerPayment row for backwards compat. The chip UI has been
  // removed (ADR 0019) but the row is kept populated so the legacy read
  // path and external code (e.g. the cost editor response) keep working.
  const upserted = await prisma.playerPayment.upsert({
    where: {
      eventCostId_playerName: { eventCostId: eventCost.id, playerName },
    },
    create: {
      eventCostId: eventCost.id,
      playerName,
      amount: netPlayerPaymentCents / 100,
      status: netPlayerPaymentCents === 0 ? "paid" : "pending",
      ...(netPlayerPaymentCents === 0 && { paidAt: new Date() }),
    },
    update: {
      amount: netPlayerPaymentCents / 100,
      status: netPlayerPaymentCents === 0 ? "paid" : "pending",
      ...(netPlayerPaymentCents === 0 && { paidAt: new Date() }),
    },
  });

  return {
    mode: "per_game",
    amountCents,
    netPlayerPaymentCents,
    creditRedeemed,
    playerPaymentId: upserted.id,
    subscriptionId: null,
  };
}

/**
 * When a PlayerPayment row exists but the player has no linked User, we
 * still need *some* userId on the WalletTransaction (the schema requires it
 * for the relation). For unlinked players we create a system placeholder
 * user per (event, playerName) so the ledger stays consistent.
 */
async function ensureSystemUserId(
  eventId: string,
  playerName: string,
  existingUserId: string | null,
): Promise<string> {
  if (existingUserId) return existingUserId;
  const systemId = `system:${eventId}:${playerName}`;
  const existing = await prisma.user.findUnique({ where: { id: systemId } });
  if (existing) return systemId;
  await prisma.user.create({
    data: {
      id: systemId,
      name: playerName,
      email: `${systemId}@system.local`,
      emailVerified: false,
    },
  });
  log.info({ systemId }, "Created system user for unlinked player's ledger entry");
  return systemId;
}

// ─── recordSelfReported / recordReceived ───────────────────────────────────

export interface RecordSelfReportedArgs {
  eventId: string;
  userId: string;
  playerName: string;
}

export async function recordSelfReported(args: RecordSelfReportedArgs): Promise<void> {
  const { eventId, userId } = args;
  const eventCost = await findEventCost(eventId);
  if (!eventCost) throw new Error(`No EventCost for event ${eventId}`);

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { maxPlayers: true } });
  const maxPlayers = event?.maxPlayers ?? 1;
  const shareCents = Math.round((eventCost.totalAmount / maxPlayers) * 100);

  await prisma.walletTransaction.create({
    data: {
      eventId,
      userId,
      amountCents: shareCents,
      currency: eventCost.currency,
      direction: "credit",
      gameUnits: 0,
      reason: "payment_self_reported",
      statusAfter: "sent",
      eventInstanceId: eventId,
    },
  });
}

export interface RecordReceivedArgs {
  eventId: string;
  playerName: string;
  markedById: string;
}

export async function recordReceived(args: RecordReceivedArgs): Promise<void> {
  const { eventId, playerName, markedById } = args;
  const eventCost = await findEventCost(eventId);
  if (!eventCost) throw new Error(`No EventCost for event ${eventId}`);

  const player = await findPlayerByName(eventId, playerName);
  const userId = player?.userId ?? (await ensureSystemUserId(eventId, playerName, null));
  const maxPlayers = (await prisma.event.findUnique({ where: { id: eventId }, select: { maxPlayers: true } }))?.maxPlayers ?? 1;
  const shareCents = Math.round((eventCost.totalAmount / maxPlayers) * 100);

  await prisma.walletTransaction.create({
    data: {
      eventId,
      userId,
      amountCents: shareCents,
      currency: eventCost.currency,
      direction: "credit",
      gameUnits: 0,
      reason: "payment_received",
      statusAfter: "paid",
      eventInstanceId: eventId,
      markedById,
    },
  });
}

// ─── getLedgerForUser ──────────────────────────────────────────────────────

export async function getLedgerForUser(eventId: string, userId: string) {
  return prisma.walletTransaction.findMany({
    where: { eventId, userId },
    orderBy: { createdAt: "desc" },
  });
}

// ─── syncPaymentsForEvent (legacy, kept for backwards compat) ─────────────

/**
 * Recalculate payment shares for an event after player changes.
 * If no EventCost exists, this is a no-op.
 * Preserves existing payment statuses (paid/pending).
 */
export async function syncPaymentsForEvent(eventId: string): Promise<void> {
  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!eventCost) return;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, maxPlayers: true, ownerId: true, currentGameId: true },
  });
  if (!event) return;

  // ADR 0016: prefer GameParticipant for active player list
  let activePlayers: { name: string; userId: string | null }[];
  if (event.currentGameId) {
    const participants = await prisma.gameParticipant.findMany({
      where: { gameId: event.currentGameId, archivedAt: null },
      include: { eventPlayer: { select: { name: true, userId: true } } },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
    });
    activePlayers = participants.map((p) => ({ name: p.eventPlayer.name, userId: p.eventPlayer.userId }));
  } else {
    const players = await prisma.player.findMany({
      where: { eventId, archivedAt: null },
      orderBy: { order: "asc" },
      take: event.maxPlayers,
      select: { name: true, userId: true },
    });
    activePlayers = players;
  }
  const share = activePlayers.length > 0 ? eventCost.totalAmount / activePlayers.length : 0;

  for (const player of activePlayers) {
    const isOwner = event.ownerId && player.userId === event.ownerId;
    await prisma.playerPayment.upsert({
      where: {
        eventCostId_playerName: { eventCostId: eventCost.id, playerName: player.name },
      },
      create: {
        eventCostId: eventCost.id,
        playerName: player.name,
        amount: share,
        ...(isOwner && { status: "paid", paidAt: new Date() }),
      },
      update: {
        amount: share,
      },
    });
  }

  const activeNames = new Set(activePlayers.map((p) => p.name));
  await prisma.playerPayment.deleteMany({
    where: {
      eventCostId: eventCost.id,
      playerName: { notIn: [...activeNames] },
    },
  });
}

// ─── Historical Settlement (ADR 0019) ─────────────────────────────────────

export interface SettleHistoricalGameArgs {
  eventId: string;
  gameHistoryId: string;
  playerName: string;
  markedById: string;
  method?: string | null;
  amountCents?: number; // defaults to the snapshot entry's amount
  payerUserId?: string | null; // who actually handed over the money (defaults to the player)
  paidToUserId?: string | null; // who received the money (defaults to the event owner)
}

export interface SettleHistoricalResult {
  written: boolean;
  walletTransactionId: string | null;
  reason: "created" | "already-settled" | "no-snapshot" | "no-event-player";
}

export async function settleHistoricalGame(
  args: SettleHistoricalGameArgs,
): Promise<SettleHistoricalResult> {
  const { eventId, gameHistoryId, playerName, markedById, method, amountCents, payerUserId, paidToUserId } = args;

  const idempotencyKey = `settle-historical:${gameHistoryId}:${playerName}:${payerUserId ?? "_"}:${paidToUserId ?? "_"}`;
  const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) return { written: false, walletTransactionId: existing.id, reason: "already-settled" };

  const eventPlayer = await prisma.eventPlayer.findUnique({
    where: { eventId_name: { eventId, name: playerName } },
    select: { userId: true },
  });
  if (!eventPlayer?.userId) return { written: false, walletTransactionId: null, reason: "no-event-player" };

  const eventCost = await prisma.eventCost.findUnique({ where: { eventId }, select: { currency: true } });
  const currency = eventCost?.currency ?? "EUR";

  // Use the snapshot's amount for the entry if not provided. The snapshot
  // is the source of truth for "what was owed" at the time of the game.
  let effectiveAmountCents = amountCents;
  if (effectiveAmountCents === undefined || effectiveAmountCents === null) {
    const h = await prisma.gameHistory.findUnique({
      where: { id: gameHistoryId },
      select: { paymentsSnapshot: true },
    });
    if (!h?.paymentsSnapshot) return { written: false, walletTransactionId: null, reason: "no-snapshot" };
    try {
      const entries: Array<{ playerName: string; amount: number; status: string }> = JSON.parse(h.paymentsSnapshot);
      const entry = entries.find((e) => e.playerName === playerName);
      if (!entry) return { written: false, walletTransactionId: null, reason: "no-snapshot" };
      effectiveAmountCents = Math.round(entry.amount * 100);
    } catch {
      return { written: false, walletTransactionId: null, reason: "no-snapshot" };
    }
  }

  // Resolve payer + paidTo with sensible defaults. Payer defaults to the
  // debtor (the person whose debt was cleared). paidTo defaults to the
  // event owner.
  const finalPayerUserId = payerUserId ?? eventPlayer.userId;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { ownerId: true } });
  const finalPaidToUserId = paidToUserId ?? event?.ownerId ?? null;

  const wt = await prisma.walletTransaction.create({
    data: {
      eventId,
      userId: eventPlayer.userId,
      amountCents: effectiveAmountCents,
      currency,
      direction: "credit",
      reason: "payment_received",
      statusAfter: "paid",
      eventInstanceId: eventId,
      gameHistoryId,
      playerName,
      markedById,
      payerUserId: finalPayerUserId,
      paidToUserId: finalPaidToUserId,
      note: method ?? null,
      idempotencyKey,
    },
  });
  return { written: true, walletTransactionId: wt.id, reason: "created" };
}

export interface SettleAllHistoricalArgs {
  eventId: string;
  playerName: string;
  markedById: string;
  payerUserId?: string | null;
  paidToUserId?: string | null;
}

export interface SettleAllHistoricalResult {
  settled: number;
  skipped: number;
  failed: number;
  details: Array<{ gameHistoryId: string; reason: SettleHistoricalResult["reason"] }>;
}

export async function settleAllHistoricalForPlayer(
  args: SettleAllHistoricalArgs,
): Promise<SettleAllHistoricalResult> {
  const { eventId, playerName, markedById, payerUserId, paidToUserId } = args;
  const result: SettleAllHistoricalResult = { settled: 0, skipped: 0, failed: 0, details: [] };

  // Find every GameHistory for this event with a paymentsSnapshot that
  // includes this player as `pending` or `sent` (i.e. the ones that need
  // settling).
  const histories = await prisma.gameHistory.findMany({
    where: { eventId, status: { not: "cancelled" }, paymentsSnapshot: { not: null } },
    select: { id: true, paymentsSnapshot: true },
    orderBy: { dateTime: "asc" },
  });

  for (const h of histories) {
    if (!h.paymentsSnapshot) continue;
    let entries: Array<{ playerName: string; amount: number; status: string }>;
    try {
      entries = JSON.parse(h.paymentsSnapshot);
    } catch {
      continue;
    }
    const entry = entries.find((e) => e.playerName === playerName);
    if (!entry) continue;
    if (entry.status !== "pending" && entry.status !== "sent") continue;

    const r = await settleHistoricalGame({
      eventId,
      gameHistoryId: h.id,
      playerName,
      markedById,
      payerUserId,
      paidToUserId,
    });
    if (r.reason === "created") result.settled++;
    else if (r.reason === "already-settled") result.skipped++;
    else result.failed++;
    result.details.push({ gameHistoryId: h.id, reason: r.reason });
  }
  return result;
}
