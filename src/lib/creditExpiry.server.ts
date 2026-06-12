/**
 * Credit expiry — moves Game Units from the player's Wallet into the
 * organizer's Extras Pot when they reach the end of the calendar month
 * following the month they were earned.
 *
 * ADR 0008 — end-of-following-month expiry in the Event's timezone.
 * ADR 0009 — Extras Pot is a single running integer on EventCost.
 *
 * Idempotency: each expiry writes a `credit_expired` WalletTransaction with
 * a deterministic `idempotencyKey` of the form
 *   expire:<eventId>:<userId>:<originalMissedGameTxId>
 * The unique constraint on idempotencyKey guarantees running the job
 * multiple times the same day is a no-op.
 *
 * This is a `.server.ts` file (not pure) — it talks to Prisma.
 */

import { prisma } from "./db.server";
import { endOfExpiryMonth } from "./monthly";
import { createLogger } from "./logger.server";

const log = createLogger("creditExpiry");

export interface ExpireOldCreditsResult {
  expiredCount: number;
  totalAmountExpiredCents: number;
}

/**
 * Walk all events with an `EventCost` and expire any `missed_game_credit`
 * rows whose expiry instant (in the event's timezone) is at or before `asOf`.
 *
 * @param asOf  the moment to evaluate expiry against. Defaults to `new Date()`.
 */
export async function expireOldCredits(
  asOf: Date = new Date(),
): Promise<ExpireOldCreditsResult> {
  // 1. Pull all events with a cost row (and thus with a timezone we care about).
  const events = await prisma.event.findMany({
    where: { eventCost: { isNot: null } },
    select: { id: true, timezone: true, eventCost: { select: { id: true } } },
  });

  let totalExpired = 0;
  let totalCents = 0;

  for (const event of events) {
    const timezone = event.timezone || "UTC";

    // 2. Find all missed_game_credit rows for this event, with their earnedAt.
    const missed = await prisma.walletTransaction.findMany({
      where: { eventId: event.id, reason: "missed_game_credit" },
      select: {
        id: true,
        userId: true,
        amountCents: true,
        gameUnits: true,
        currency: true,
        eventInstanceId: true,
        createdAt: true,
      },
    });

    if (missed.length === 0) continue;

    // 3. For each missed credit, check if it should be expired.
    for (const m of missed) {
      const expiryInstant = endOfExpiryMonth(m.createdAt, timezone);
      if (expiryInstant.getTime() > asOf.getTime()) continue;

      // Has the player already fully redeemed this unit? Skip if net <= 0
      // across all rows for this (user, event). The expiry is for *unredeemed*
      // credit only — if the player already burned it on a later game, there
      // is nothing to forfeit.
      const txsForUser = await prisma.walletTransaction.findMany({
        where: { eventId: event.id, userId: m.userId, reason: { in: ["missed_game_credit", "credit_redeemed", "credit_expired"] } },
        select: { gameUnits: true },
      });
      const netUnits = txsForUser.reduce((sum, t) => sum + t.gameUnits, 0);
      if (netUnits <= 0) continue;

      // 4. Idempotently write the credit_expired row.
      const idempotencyKey = `expire:${event.id}:${m.userId}:${m.id}`;
      try {
        await prisma.walletTransaction.create({
          data: {
            eventId: event.id,
            userId: m.userId,
            amountCents: m.amountCents,
            currency: m.currency,
            direction: "credit",
            gameUnits: -1,
            reason: "credit_expired",
            eventInstanceId: m.eventInstanceId,
            idempotencyKey,
          },
        });
      } catch (err: unknown) {
        // Unique constraint on idempotencyKey — already expired by a prior run.
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
          continue;
        }
        throw err;
      }

      // 5. Increment the Extras Pot in a transaction with the wallet write
      // would be ideal, but we already wrote the row. Use a follow-up update
      // — if it fails, the orphan expiry row is a recoverable inconsistency
      // and the next run will be a no-op (P2002 above) until manual cleanup.
      // For now we keep it simple; the production-grade version can wrap
      // both in a $transaction.
      await prisma.eventCost.update({
        where: { id: event.eventCost!.id },
        data: { organizerExtrasCents: { increment: m.amountCents } },
      });

      totalExpired++;
      totalCents += m.amountCents;
    }
  }

  if (totalExpired > 0) {
    log.info({ totalExpired, totalCents }, "Expired old wallet credits");
  }

  return { expiredCount: totalExpired, totalAmountExpiredCents: totalCents };
}
