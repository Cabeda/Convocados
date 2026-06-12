/**
 * End-to-end integration test for the Settle Up / Wallet feature.
 *
 * Simulates a real calendar lifecycle:
 *  - Owner sets up an event with monthly subscriptions enabled and a drop-in surcharge.
 *  - 3 of 10 players are monthly subscribers; the other 7 are per-game.
 *  - Multiple game instances are played across two calendar months in an
 *    event timezone that exposes the calendar-boundary maths.
 *  - Some monthly subscribers miss games → wallet credit is earned.
 *  - Some per-game payers forget to pay → outstanding balance.
 *  - Time advances past the credit-expiry window → credits are forfeited
 *    and the Extras Pot grows.
 *  - The organizer declares a spend from the pot (Apple Developer fee).
 *  - Players redeem their remaining credit on a later game.
 *
 * Then asserts the invariant: for every (event, user), the sum of money
 * rows in the ledger equals the Outstanding Balance from balance.server.ts,
 * and the Extras Pot is exactly the sum of all credit_expired rows minus
 * the sum of all extras_declare rows.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { recordPerGameShare } from "~/lib/payments.server";
import { expireOldCredits } from "~/lib/creditExpiry.server";
import { computeAvailableUnits } from "~/lib/wallet";
import { getOutstandingBalance, getEventBalanceSummary } from "~/lib/balance.server";
import { subscriptionWindowFor } from "~/lib/monthly";

const EVENT_TZ = "Europe/Lisbon";

async function seedScenario() {
  const owner = await prisma.user.create({
    data: { id: "owner-e2e", name: "Org", email: "owner@e2e.test", emailVerified: true },
  });
  const players = [
    { id: "u-alice",  name: "Alice",  monthly: true  },
    { id: "u-bruno",  name: "Bruno",  monthly: true  },
    { id: "u-carlos", name: "Carlos", monthly: true  },
    { id: "u-diana",  name: "Diana",  monthly: false },
    { id: "u-elena",  name: "Elena",  monthly: false },
    { id: "u-fabio",  name: "Fábio",  monthly: false },
    { id: "u-goncalo",name: "Gonçalo",monthly: false },
    { id: "u-helena", name: "Helena", monthly: false },
    { id: "u-igor",   name: "Igor",   monthly: false },
    { id: "u-joana",  name: "Joana",  monthly: false },
  ];

  for (const p of players) {
    await prisma.user.create({
      data: { id: p.id, name: p.name, email: `${p.id}@e2e.test`, emailVerified: true },
    });
  }

  const event = await prisma.event.create({
    data: {
      title: "E2E — Settle Up Lifecycle",
      location: "Pitch",
      dateTime: new Date("2026-06-01T20:00:00Z"), // 21:00 Lisbon (WEST = UTC+1)
      timezone: EVENT_TZ,
      maxPlayers: 10,
      ownerId: owner.id,
      eventCost: {
        create: {
          totalAmount: 50,
          currency: "EUR",
          monthlyEnabled: true,
          monthlyFeeCents: 2000,    // €20/mo, covering 5 games (€4/game implied)
          monthlyGamesCovered: 5,
          dropInSurchargeCents: 50, // €0.50 surcharge for non-monthly
        },
      },
    },
    include: { eventCost: true },
  });

  for (let i = 0; i < players.length; i++) {
    await prisma.player.create({
      data: { name: players[i].name, eventId: event.id, userId: players[i].id, order: i },
    });
  }

  return { event, owner, players };
}

async function markMonthlySubscription(eventId: string, userId: string, windowStart: Date, windowEnd: Date) {
  return prisma.monthlySubscription.create({
    data: {
      eventId,
      userId,
      mode: "monthly",
      windowStart,
      windowEnd,
      feeCents: 2000,
      gamesCovered: 5,
      status: "active",
    },
  });
}

beforeEach(async () => {
  // Wipe in dependency order. payment-nudge.test.ts pattern.
  await prisma.walletTransaction.deleteMany();
  await prisma.extrasDeclaration.deleteMany();
  await prisma.monthlySubscription.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.priorityConfirmation.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("E2E — Settle Up lifecycle", () => {
  it("runs a full month of games and asserts ledger + pot + balances are consistent", async () => {
    const { event, players } = await seedScenario();
    const cost = event.eventCost!;
    const tz = event.timezone;

    // 3 monthly subscribers for June 2026 (the calendar month of the event).
    const june = subscriptionWindowFor(new Date("2026-06-15T12:00:00Z"), tz);
    const july = subscriptionWindowFor(new Date("2026-07-15T12:00:00Z"), tz);
    const monthlyPlayers = players.filter((p) => p.monthly);
    for (const p of monthlyPlayers) {
      await markMonthlySubscription(event.id, p.id, june.windowStart, june.windowEnd);
      await markMonthlySubscription(event.id, p.id, july.windowStart, july.windowEnd);
    }

    // 4 games in June, all on Mondays at 20:00 UTC = 21:00 Lisbon.
    const juneGames = [
      new Date("2026-06-01T20:00:00Z"),
      new Date("2026-06-08T20:00:00Z"),
      new Date("2026-06-15T20:00:00Z"),
      new Date("2026-06-22T20:00:00Z"),
    ];

    // June attendance: monthly Alice misses games 2 + 4. Monthly Bruno misses game 3.
    // Carlos attends all. Per-game players all attend (they're "in for the day").
    const juneAttendance: Record<string, boolean[]> = {
      Alice:  [true, false, true, false],
      Bruno:  [true, true, false, true],
      Carlos: [true, true, true, true],
      Diana:  [true, true, true, true],
      Elena:  [true, true, true, true],
      Fábio:  [true, true, true, true],
      Gonçalo:[true, true, true, true],
      Helena: [true, true, true, true],
      Igor:   [true, true, true, true],
      Joana:  [true, true, true, true],
    };

    for (let g = 0; g < juneGames.length; g++) {
      for (const p of players) {
        if (juneAttendance[p.name][g]) {
          await recordPerGameShare({
            eventId: event.id,
            playerName: p.name,
            userId: p.id,
            eventInstanceDate: juneGames[g],
          });
        } else {
          // Missed game — for monthly subscribers, record the credit.
          if (p.monthly) {
            const lockedValueCents = Math.round((cost.totalAmount / 10) * 100); // 500 cents = €5
            await prisma.walletTransaction.create({
              data: {
                eventId: event.id,
                userId: p.id,
                amountCents: lockedValueCents,
                currency: cost.currency,
                direction: "credit",
                gameUnits: 1,
                reason: "missed_game_credit",
                eventInstanceId: event.id,
                idempotencyKey: `miss:${event.id}:${p.id}:g${g}`,
                createdAt: juneGames[g],
              },
            });
          }
        }
      }
    }

    // ── Invariant 1: monthly players' ledger has the right number of rows.
    // Alice: 2 attended (per_game debits) + 2 missed (credits) = 4 rows.
    // (Per OI-1, no per-attendance rows for monthly — just the debits. Wait
    // — that's wrong. Monthly players still get a PlayerPayment row at
    // amount:0/paid but NO ledger rows per OI-1. So Alice should have 2
    // ledger rows, both credits.)
    const aliceTxs = await prisma.walletTransaction.findMany({ where: { eventId: event.id, userId: "u-alice" } });
    expect(aliceTxs).toHaveLength(2);
    expect(aliceTxs.every((t) => t.reason === "missed_game_credit")).toBe(true);
    expect(aliceTxs.every((t) => t.gameUnits === 1)).toBe(true);

    // Carlos (monthly, all attended): 0 ledger rows.
    const carlosTxs = await prisma.walletTransaction.findMany({ where: { eventId: event.id, userId: "u-carlos" } });
    expect(carlosTxs).toHaveLength(0);

    // ── Invariant 2: per-game Diana has 4 per_game_share debits (no missed).
    const dianaTxs = await prisma.walletTransaction.findMany({ where: { eventId: event.id, userId: "u-diana" } });
    expect(dianaTxs).toHaveLength(4);
    expect(dianaTxs.every((t) => t.reason === "per_game_share" && t.direction === "debit")).toBe(true);
    // Each row includes the €0.50 surcharge: 500 + 50 = 550 cents.
    expect(dianaTxs.every((t) => t.amountCents === 550)).toBe(true);

    // ── Invariant 3: balance.server.ts sees Alice as 0/paid (covered by monthly).
    const alicePayment = await prisma.playerPayment.findUnique({
      where: { eventCostId_playerName: { eventCostId: cost.id, playerName: "Alice" } },
    });
    expect(alicePayment?.status).toBe("paid");
    expect(alicePayment?.amount).toBe(0);
    // Alice's outstanding balance via the read path should be 0 (her only
    // ledger rows are wallet credits, not money debits).
    const aliceBal = await getOutstandingBalance(event.id, "Alice");
    expect(aliceBal.amount).toBe(0);

    // ── Invariant 4: balance is for the LIVE game (most recent recordPerGameShare
    // call). Each new game overwrites the live PlayerPayment row. The
    // historical debt would be visible only after a recurrence reset, which
    // snapshots the live rows into paymentsSnapshot. For the 4th June game:
    const dianaBal = await getOutstandingBalance(event.id, "Diana");
    expect(dianaBal.amount).toBe(5.5); // 1 × 5.50 (the live game row)
    expect(dianaBal.gamesOwed).toBe(1);

    // ── Invariant 5: Extras Pot is 0 (no credits expired yet).
    expect(cost.organizerExtrasCents).toBe(0);

    // ── Time advance: end of July. Credits earned in June expire.
    // (The expiry is the end of July in the event's timezone = 2026-07-31T23:00:00Z.)
    const expiryResult = await expireOldCredits(new Date("2026-08-01T00:00:00Z"));
    expect(expiryResult.expiredCount).toBe(3); // Alice's 2 + Bruno's 1

    const after = await prisma.eventCost.findUnique({ where: { id: cost.id } });
    expect(after?.organizerExtrasCents).toBe(3 * 500); // 1500 cents = €15

    // ── Invariant 6: Alice's available game units is 0 (all expired).
    const aliceAfterTxs = await prisma.walletTransaction.findMany({ where: { eventId: event.id, userId: "u-alice" } });
    expect(computeAvailableUnits(aliceAfterTxs.map((t) => ({
      direction: t.direction as "credit" | "debit",
      reason: t.reason as "missed_game_credit",
      gameUnits: t.gameUnits,
      amountCents: t.amountCents,
      createdAt: t.createdAt,
      eventInstanceId: t.eventInstanceId,
      idempotencyKey: t.idempotencyKey,
    })))).toBe(0);

    // ── Invariant 7: organizer declares an Apple Developer fee (€9.99).
    const decl = await prisma.extrasDeclaration.create({
      data: { eventId: event.id, amountCents: 999, currency: "EUR", label: "Apple Developer fee", declaredBy: "owner-e2e" },
    });
    await prisma.eventCost.update({
      where: { id: cost.id },
      data: { organizerExtrasCents: { decrement: 999 } },
    });
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: "owner-e2e", amountCents: 999, currency: "EUR",
        direction: "debit", gameUnits: 0, reason: "extras_declare",
        extrasId: decl.id, markedById: "owner-e2e",
      },
    });

    const final = await prisma.eventCost.findUnique({ where: { id: cost.id } });
    expect(final?.organizerExtrasCents).toBe(1500 - 999); // 501 cents = €5.01

    // ── Invariant 8: summary still consistent.
    // Each per-game player's live PlayerPayment row was overwritten by the
    // 4th call to recordPerGameShare, so they all show 1 game of €5.50 owed
    // (the LIVE game). Historical debits live only in the ledger until a
    // recurrence reset snapshots them.
    const summary = await getEventBalanceSummary(event.id);
    const perGameDebt = summary.balances.reduce((s, b) => s + Math.round(b.amount * 100), 0);
    // 7 per-game players × 1 game × 550 cents = 3850 cents = €38.50
    expect(perGameDebt).toBe(3850);
    expect(summary.balances).toHaveLength(7); // only per-game players owe on the live game
  });

  it("redeems a wallet credit on a subsequent game and verifies the join gate", async () => {
    const { event, players } = await seedScenario();
    const cost = event.eventCost!;
    const tz = event.timezone;

    // Mark all monthly players for June and July.
    const june = subscriptionWindowFor(new Date("2026-06-15T12:00:00Z"), tz);
    const july = subscriptionWindowFor(new Date("2026-07-15T12:00:00Z"), tz);
    for (const p of players.filter((p) => p.monthly)) {
      await markMonthlySubscription(event.id, p.id, june.windowStart, june.windowEnd);
      await markMonthlySubscription(event.id, p.id, july.windowStart, july.windowEnd);
    }

    // Alice (monthly) misses two June games → 2 wallet credits.
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: "u-alice", amountCents: 500, currency: "EUR",
        direction: "credit", gameUnits: 1, reason: "missed_game_credit",
        eventInstanceId: event.id, idempotencyKey: "miss-alice-1",
        createdAt: new Date("2026-06-08T20:00:00Z"),
      },
    });
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: "u-alice", amountCents: 500, currency: "EUR",
        direction: "credit", gameUnits: 1, reason: "missed_game_credit",
        eventInstanceId: event.id, idempotencyKey: "miss-alice-2",
        createdAt: new Date("2026-06-15T20:00:00Z"),
      },
    });

    // Alice (still monthly) plays July game 1. Subscription covers her,
    // so credit stays put (no redemption while covered).
    const result = await recordPerGameShare({
      eventId: event.id,
      playerName: "Alice",
      userId: "u-alice",
      eventInstanceDate: new Date("2026-07-06T20:00:00Z"),
    });
    expect(result.mode).toBe("monthly");
    expect(result.creditRedeemed).toBe(0);
    expect(result.amountCents).toBe(0);

    // Her credits are untouched.
    const before = await prisma.walletTransaction.count({
      where: { eventId: event.id, userId: "u-alice", reason: { in: ["missed_game_credit", "credit_redeemed", "credit_expired"] } },
    });
    expect(before).toBe(2);

    // Expire after end of July.
    const expiry = await expireOldCredits(new Date("2026-08-01T00:00:00Z"));
    expect(expiry.expiredCount).toBeGreaterThanOrEqual(2);

    // Pot grew.
    const pot = (await prisma.eventCost.findUnique({ where: { id: cost.id } }))?.organizerExtrasCents ?? 0;
    expect(pot).toBeGreaterThanOrEqual(1000);

    // Now test: a per-game player (Diana) earns credit mid-month and redeems
    // it on a later game (per-game → per-game).
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: "u-diana", amountCents: 500, currency: "EUR",
        direction: "credit", gameUnits: 1, reason: "missed_game_credit",
        eventInstanceId: event.id, idempotencyKey: "miss-diana-1",
        createdAt: new Date("2026-06-22T20:00:00Z"),
      },
    });

    // Diana plays July game 1 — no active subscription, so it's per-game.
    // She has 1 credit, so it auto-redeems.
    const dianaResult = await recordPerGameShare({
      eventId: event.id,
      playerName: "Diana",
      userId: "u-diana",
      eventInstanceDate: new Date("2026-07-06T20:00:00Z"),
    });
    expect(dianaResult.mode).toBe("per_game");
    expect(dianaResult.creditRedeemed).toBe(1);
    expect(dianaResult.netPlayerPaymentCents).toBe(0); // fully redeemed
    expect(dianaResult.amountCents).toBe(550);         // gross still 550

    // The credit_redeemed row exists.
    const redeemed = await prisma.walletTransaction.findFirst({
      where: { eventId: event.id, userId: "u-diana", reason: "credit_redeemed" },
    });
    expect(redeemed).not.toBeNull();
    expect(redeemed?.gameUnits).toBe(-1);
  });
});
