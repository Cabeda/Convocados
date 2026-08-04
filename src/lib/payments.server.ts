/**
 * Payment recording — writes to the per-Event `WalletTransaction` ledger
 * (ADR 0007) and, for backwards compatibility with `PostGameBanner` and the
 * existing snapshot pipeline, also keeps a `PlayerPayment` row per active
 * player (OI-2: amount:0, status:paid for monthly-covered or fully-redeemed
 * rows so the rest of the system keeps working).
 *
 * ADR 0007 — Wallet ledger is the single source of truth for money.
 * ADR 0008 — Monthly subscriptions cover non-cancelled Event instances in
 *             their Subscription Window; missed games earn 1 Game Unit.
 * OI-1    — Monthly subscribers have no per-attendance ledger rows.
 * OI-2    — Monthly-covered or fully-redeemed rows still create a
 *            PlayerPayment row with amount:0, status:paid.
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

/** ADR 0019: Resolve per-game share info — maxPlayers, gameId, shareCents. */
async function resolveShareInfo(eventId: string, totalAmount: number) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { maxPlayers: true, currentGameId: true },
  });
  const maxPlayers = event?.maxPlayers ?? 1;
  const gameId = event?.currentGameId ?? eventId;
  const shareCents = Math.round((totalAmount / maxPlayers) * 100);
  return { maxPlayers, gameId, shareCents };
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
  const { maxPlayers, gameId } = await resolveShareInfo(eventId, eventCost.totalAmount);
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
    // Per OI-2: zero-amount paid PlayerPayment row.
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
      eventInstanceId: gameId,
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
        eventInstanceId: gameId,
      },
    });
  }

  // 6. Upsert PlayerPayment row for backwards compat.
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

  const { gameId, shareCents } = await resolveShareInfo(eventId, eventCost.totalAmount);

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
      eventInstanceId: gameId,
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
  const { gameId, shareCents } = await resolveShareInfo(eventId, eventCost.totalAmount);

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
      eventInstanceId: gameId,
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
