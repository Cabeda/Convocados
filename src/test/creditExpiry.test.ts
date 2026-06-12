import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { expireOldCredits } from "~/lib/creditExpiry.server";

async function seedEventWithCost(timezone: string) {
  return prisma.event.create({
    data: {
      title: "Test",
      location: "Pitch",
      dateTime: new Date("2026-06-01T20:00:00Z"),
      timezone,
      ownerId: null,
      eventCost: {
        create: { totalAmount: 50, currency: "EUR" },
      },
    },
    include: { eventCost: true },
  });
}

async function seedUser(id: string) {
  return prisma.user.create({
    data: { id, name: id, email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedMissedCredit(args: {
  eventId: string;
  userId: string;
  amountCents: number;
  earnedAt: Date;
  eventInstanceId?: string;
  idempotencyKey: string;
}) {
  return prisma.walletTransaction.create({
    data: {
      eventId: args.eventId,
      userId: args.userId,
      amountCents: args.amountCents,
      currency: "EUR",
      direction: "credit",
      gameUnits: 1,
      reason: "missed_game_credit",
      eventInstanceId: args.eventInstanceId ?? null,
      idempotencyKey: args.idempotencyKey,
      createdAt: args.earnedAt,
    },
  });
}

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.extrasDeclaration.deleteMany();
  await prisma.monthlySubscription.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("expireOldCredits", () => {
  it("expires credits earned in month M at the end of month M+1 (UTC)", async () => {
    const event = await seedEventWithCost("UTC");
    await seedUser("u1");
    // Credit earned 2026-06-15, expires at end of July 2026 UTC.
    await seedMissedCredit({
      eventId: event.id,
      userId: "u1",
      amountCents: 500,
      earnedAt: new Date("2026-06-15T20:00:00Z"),
      idempotencyKey: "k1",
    });

    // Run on 2026-07-20 — should NOT expire yet (still July).
    let result = await expireOldCredits(new Date("2026-07-20T00:00:00Z"));
    expect(result.expiredCount).toBe(0);

    // Run on 2026-08-01 — should expire (end of July has passed).
    result = await expireOldCredits(new Date("2026-08-01T00:00:00Z"));
    expect(result.expiredCount).toBe(1);

    // The Extras Pot was credited by 500 cents.
    const eventAfter = await prisma.event.findUnique({
      where: { id: event.id },
      include: { eventCost: true },
    });
    expect(eventAfter?.eventCost?.organizerExtrasCents).toBe(500);

    // A credit_expired row was written.
    const expired = await prisma.walletTransaction.findFirst({
      where: { eventId: event.id, reason: "credit_expired" },
    });
    expect(expired).not.toBeNull();
    expect(expired?.gameUnits).toBe(-1);
    expect(expired?.amountCents).toBe(500);
    expect(expired?.direction).toBe("credit");
  });

  it("is idempotent: running twice on the same day does not double-credit the Extras Pot", async () => {
    const event = await seedEventWithCost("UTC");
    await seedUser("u1");
    await seedMissedCredit({
      eventId: event.id,
      userId: "u1",
      amountCents: 500,
      earnedAt: new Date("2026-06-15T20:00:00Z"),
      idempotencyKey: "k1",
    });

    const r1 = await expireOldCredits(new Date("2026-08-01T00:00:00Z"));
    const r2 = await expireOldCredits(new Date("2026-08-01T00:00:00Z"));
    expect(r1.expiredCount).toBe(1);
    expect(r2.expiredCount).toBe(0);

    const eventAfter = await prisma.event.findUnique({
      where: { id: event.id },
      include: { eventCost: true },
    });
    expect(eventAfter?.eventCost?.organizerExtrasCents).toBe(500);

    const expiredRows = await prisma.walletTransaction.findMany({
      where: { eventId: event.id, reason: "credit_expired" },
    });
    expect(expiredRows).toHaveLength(1);
  });

  it("does not expire credits whose earned date is in the current calendar month or later", async () => {
    const event = await seedEventWithCost("UTC");
    await seedUser("u1");
    await seedMissedCredit({
      eventId: event.id,
      userId: "u1",
      amountCents: 500,
      earnedAt: new Date("2026-08-15T20:00:00Z"),
      idempotencyKey: "k1",
    });

    const result = await expireOldCredits(new Date("2026-08-20T00:00:00Z"));
    expect(result.expiredCount).toBe(0);
  });

  it("handles timezone: a credit earned in Europe/Lisbon late June expires at end of July Lisbon time", async () => {
    const event = await seedEventWithCost("Europe/Lisbon");
    await seedUser("u1");
    // Earned 2026-06-30T22:00:00Z = 2026-06-30T23:00:00 Lisbon (WEST = UTC+1).
    // Expires at end of July Lisbon = 2026-07-31T23:59:59 Lisbon = 2026-07-31T22:59:59Z.
    await seedMissedCredit({
      eventId: event.id,
      userId: "u1",
      amountCents: 500,
      earnedAt: new Date("2026-06-30T22:00:00Z"),
      idempotencyKey: "k1",
    });

    // Run on 2026-07-31T22:00:00Z (= 2026-07-31T23:00:00 Lisbon) — still in July Lisbon, should NOT expire.
    let r = await expireOldCredits(new Date("2026-07-31T22:00:00Z"));
    expect(r.expiredCount).toBe(0);

    // Run on 2026-07-31T23:00:00Z (= 2026-08-01T00:00:00 Lisbon) — past end of July Lisbon, should expire.
    r = await expireOldCredits(new Date("2026-07-31T23:00:00Z"));
    expect(r.expiredCount).toBe(1);
  });

  it("respects already-redeemed credits: a credit that was redeemed before expiry does not credit the Extras Pot", async () => {
    const event = await seedEventWithCost("UTC");
    await seedUser("u1");
    // Earned 500 cents, then fully redeemed (-1 unit) — should be a no-op at expiry.
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: "u1", amountCents: 500, currency: "EUR",
        direction: "credit", gameUnits: 1, reason: "missed_game_credit",
        eventInstanceId: null, idempotencyKey: "k1",
        createdAt: new Date("2026-06-15T20:00:00Z"),
      },
    });
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: "u1", amountCents: 0, currency: "EUR",
        direction: "credit", gameUnits: -1, reason: "credit_redeemed",
        eventInstanceId: "inst-1", idempotencyKey: "k2",
        createdAt: new Date("2026-06-22T20:00:00Z"),
      },
    });

    const result = await expireOldCredits(new Date("2026-08-01T00:00:00Z"));
    expect(result.expiredCount).toBe(0);

    const eventAfter = await prisma.event.findUnique({
      where: { id: event.id }, include: { eventCost: true },
    });
    expect(eventAfter?.eventCost?.organizerExtrasCents).toBe(0);
  });
});
