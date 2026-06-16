import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  recordPerGameShare,
  recordSelfReported,
  recordReceived,
  getLedgerForUser,
} from "~/lib/payments.server";

async function seedUser(id: string) {
  return prisma.user.create({
    data: { id, name: id, email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEventWithCost(args: {
  totalAmount?: number;
  dropInSurchargeCents?: number;
  monthlyEnabled?: boolean;
  monthlyFeeCents?: number;
  monthlyGamesCovered?: number;
  timezone?: string;
  ownerId?: string | null;
}) {
  return prisma.event.create({
    data: {
      title: "T",
      location: "Pitch",
      dateTime: new Date("2026-06-15T20:00:00Z"),
      timezone: args.timezone ?? "UTC",
      ownerId: args.ownerId ?? null,
      maxPlayers: 10,
      eventCost: {
        create: {
          totalAmount: args.totalAmount ?? 50,
          currency: "EUR",
          dropInSurchargeCents: args.dropInSurchargeCents ?? 0,
          monthlyEnabled: args.monthlyEnabled ?? false,
          monthlyFeeCents: args.monthlyFeeCents ?? null,
          monthlyGamesCovered: args.monthlyGamesCovered ?? 5,
        },
      },
    },
    include: { eventCost: true },
  });
}

async function addPlayer(eventId: string, name: string, userId: string | null = null) {
  return prisma.player.create({
    data: { name, eventId, userId, order: 0 },
  });
}

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.monthlySubscription.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ─── recordPerGameShare ─────────────────────────────────────────────────────

describe("recordPerGameShare — plain per-game (no monthly, no credit)", () => {
  it("writes a per_game_share debit and a PlayerPayment row with status pending", async () => {
    const event = await seedEventWithCost({ totalAmount: 50 });
    await addPlayer(event.id, "Alice");

    const result = await recordPerGameShare({
      eventId: event.id,
      playerName: "Alice",
      userId: null,
      eventInstanceDate: new Date("2026-06-15T20:00:00Z"),
    });

    expect(result.mode).toBe("per_game");
    expect(result.amountCents).toBe(500);

    const txs = await prisma.walletTransaction.findMany({ where: { eventId: event.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0].reason).toBe("per_game_share");
    expect(txs[0].direction).toBe("debit");
    expect(txs[0].amountCents).toBe(500);

    const payment = await prisma.playerPayment.findUnique({
      where: { eventCostId_playerName: { eventCostId: event.eventCost!.id, playerName: "Alice" } },
    });
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe("pending");
    expect(payment?.amount).toBeCloseTo(5);
  });

  it("adds the drop-in surcharge to the amount for non-monthly players", async () => {
    const event = await seedEventWithCost({ totalAmount: 50, dropInSurchargeCents: 50 });
    await addPlayer(event.id, "Alice");

    const result = await recordPerGameShare({
      eventId: event.id,
      playerName: "Alice",
      userId: null,
      eventInstanceDate: new Date("2026-06-15T20:00:00Z"),
    });

    expect(result.amountCents).toBe(550);

    const payment = await prisma.playerPayment.findUnique({
      where: { eventCostId_playerName: { eventCostId: event.eventCost!.id, playerName: "Alice" } },
    });
    expect(payment?.amount).toBeCloseTo(5.5);
  });
});

describe("recordPerGameShare — monthly subscriber (active subscription covers the date)", () => {
  it("writes nothing to the ledger and creates a zero-amount paid PlayerPayment row", async () => {
    const event = await seedEventWithCost({
      totalAmount: 50,
      monthlyEnabled: true,
      monthlyFeeCents: 2000,
    });
    const u = await seedUser("u1");
    await addPlayer(event.id, "Alice", u.id);
    await prisma.monthlySubscription.create({
      data: {
        eventId: event.id,
        userId: u.id,
        mode: "monthly",
        windowStart: new Date("2026-06-01T00:00:00Z"),
        windowEnd: new Date("2026-07-01T00:00:00Z"),
        feeCents: 2000,
        gamesCovered: 5,
        status: "active",
      },
    });

    const result = await recordPerGameShare({
      eventId: event.id,
      playerName: "Alice",
      userId: u.id,
      eventInstanceDate: new Date("2026-06-15T20:00:00Z"),
    });

    expect(result.mode).toBe("monthly");
    expect(result.amountCents).toBe(0);

    // Per OI-1: no per-attendance ledger rows.
    const txs = await prisma.walletTransaction.findMany({ where: { eventId: event.id } });
    expect(txs).toHaveLength(0);

    // Per OI-2: keep a PlayerPayment row at 0/paid for backwards compat.
    const payment = await prisma.playerPayment.findUnique({
      where: { eventCostId_playerName: { eventCostId: event.eventCost!.id, playerName: "Alice" } },
    });
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe("paid");
    expect(payment?.amount).toBe(0);
  });

  it("falls back to per-game if the subscription is cancelled", async () => {
    const event = await seedEventWithCost({
      totalAmount: 50,
      monthlyEnabled: true,
      monthlyFeeCents: 2000,
    });
    const u = await seedUser("u1");
    await addPlayer(event.id, "Alice", u.id);
    await prisma.monthlySubscription.create({
      data: {
        eventId: event.id,
        userId: u.id,
        mode: "monthly",
        windowStart: new Date("2026-06-01T00:00:00Z"),
        windowEnd: new Date("2026-07-01T00:00:00Z"),
        feeCents: 2000,
        gamesCovered: 5,
        status: "cancelled",
      },
    });

    const result = await recordPerGameShare({
      eventId: event.id,
      playerName: "Alice",
      userId: u.id,
      eventInstanceDate: new Date("2026-06-15T20:00:00Z"),
    });

    expect(result.mode).toBe("per_game");
    expect(result.amountCents).toBe(500);
  });

  it("falls back to per-game if the subscription covers a different month", async () => {
    const event = await seedEventWithCost({
      totalAmount: 50,
      monthlyEnabled: true,
      monthlyFeeCents: 2000,
    });
    const u = await seedUser("u1");
    await addPlayer(event.id, "Alice", u.id);
    // Subscription was for May, not June.
    await prisma.monthlySubscription.create({
      data: {
        eventId: event.id,
        userId: u.id,
        mode: "monthly",
        windowStart: new Date("2026-05-01T00:00:00Z"),
        windowEnd: new Date("2026-06-01T00:00:00Z"),
        feeCents: 2000,
        gamesCovered: 5,
        status: "active",
      },
    });

    const result = await recordPerGameShare({
      eventId: event.id,
      playerName: "Alice",
      userId: u.id,
      eventInstanceDate: new Date("2026-06-15T20:00:00Z"),
    });

    expect(result.mode).toBe("per_game");
    expect(result.amountCents).toBe(500);
  });
});

describe("recordPerGameShare — credit available (redeems 1 unit)", () => {
  it("redeems 1 game unit, writes a credit_redeemed row, and the PlayerPayment is amount:0/paid", async () => {
    const event = await seedEventWithCost({ totalAmount: 50 });
    const u = await seedUser("u1");
    await addPlayer(event.id, "Alice", u.id);
    // Player has 1 game unit available from a prior missed game.
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: u.id, amountCents: 500, currency: "EUR",
        direction: "credit", gameUnits: 1, reason: "missed_game_credit",
        eventInstanceId: "prior-game", idempotencyKey: "k1",
        createdAt: new Date("2026-06-08T20:00:00Z"),
      },
    });

    const result = await recordPerGameShare({
      eventId: event.id,
      playerName: "Alice",
      userId: u.id,
      eventInstanceDate: new Date("2026-06-15T20:00:00Z"),
    });

    expect(result.mode).toBe("per_game");
    expect(result.creditRedeemed).toBe(1);
    expect(result.amountCents).toBe(500); // still writes the per_game_share debit
    expect(result.netPlayerPaymentCents).toBe(0); // but the player-payment row is 0/paid

    // Three ledger rows: the pre-seeded missed_game_credit, the new
    // per_game_share debit, and the new credit_redeemed credit.
    const txs = await prisma.walletTransaction.findMany({ where: { eventId: event.id } });
    expect(txs).toHaveLength(3);
    const debit = txs.find((t) => t.reason === "per_game_share");
    const redeemed = txs.find((t) => t.reason === "credit_redeemed");
    expect(debit).toBeDefined();
    expect(redeemed).toBeDefined();
    expect(redeemed?.gameUnits).toBe(-1);
    expect(redeemed?.eventInstanceId).toBe(event.id);

    const payment = await prisma.playerPayment.findUnique({
      where: { eventCostId_playerName: { eventCostId: event.eventCost!.id, playerName: "Alice" } },
    });
    expect(payment?.amount).toBe(0);
    expect(payment?.status).toBe("paid");
  });
});

// ─── recordSelfReported ─────────────────────────────────────────────────────

describe("recordSelfReported", () => {
  it("writes a payment_self_reported credit with statusAfter sent", async () => {
    const event = await seedEventWithCost({ totalAmount: 50 });
    const u = await seedUser("u1");
    await addPlayer(event.id, "Alice", u.id);
    // Pre-existing per_game_share debit
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: u.id, amountCents: 500, currency: "EUR",
        direction: "debit", gameUnits: 0, reason: "per_game_share",
        eventInstanceId: event.id, idempotencyKey: null,
        createdAt: new Date("2026-06-15T20:00:00Z"),
      },
    });

    await recordSelfReported({
      eventId: event.id,
      userId: u.id,
      playerName: "Alice",
    });

    const txs = await prisma.walletTransaction.findMany({ where: { eventId: event.id } });
    expect(txs).toHaveLength(2);
    const sent = txs.find((t) => t.reason === "payment_self_reported");
    expect(sent).toBeDefined();
    expect(sent?.direction).toBe("credit");
    expect(sent?.amountCents).toBe(500);
    expect(sent?.statusAfter).toBe("sent");
  });
});

// ─── recordReceived ─────────────────────────────────────────────────────────

describe("recordReceived", () => {
  it("writes a payment_received credit with statusAfter paid", async () => {
    const event = await seedEventWithCost({ totalAmount: 50 });
    const owner = await seedUser("owner");
    await addPlayer(event.id, "Alice");
    // Pre-existing per_game_share debit
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: (await prisma.user.create({ data: { id: "u-alice", name: "Alice", email: "alice@test.com", emailVerified: true } })).id,
        amountCents: 500, currency: "EUR",
        direction: "debit", gameUnits: 0, reason: "per_game_share",
        eventInstanceId: event.id, idempotencyKey: null,
        createdAt: new Date("2026-06-15T20:00:00Z"),
      },
    });

    await recordReceived({
      eventId: event.id,
      playerName: "Alice",
      markedById: owner.id,
    });

    const txs = await prisma.walletTransaction.findMany({ where: { eventId: event.id } });
    const received = txs.find((t) => t.reason === "payment_received");
    expect(received).toBeDefined();
    expect(received?.direction).toBe("credit");
    expect(received?.amountCents).toBe(500);
    expect(received?.statusAfter).toBe("paid");
    expect(received?.markedById).toBe(owner.id);
  });
});

// ─── getLedgerForUser ───────────────────────────────────────────────────────

describe("getLedgerForUser", () => {
  it("returns only the requested user's transactions, newest first", async () => {
    const event = await seedEventWithCost({ totalAmount: 50 });
    const u1 = await seedUser("u1");
    const u2 = await seedUser("u2");
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: u1.id, amountCents: 500, currency: "EUR",
        direction: "debit", gameUnits: 0, reason: "per_game_share",
        eventInstanceId: null, idempotencyKey: null,
        createdAt: new Date("2026-06-15T20:00:00Z"),
      },
    });
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id, userId: u2.id, amountCents: 500, currency: "EUR",
        direction: "debit", gameUnits: 0, reason: "per_game_share",
        eventInstanceId: null, idempotencyKey: null,
        createdAt: new Date("2026-06-15T21:00:00Z"),
      },
    });

    const u1Ledger = await getLedgerForUser(event.id, u1.id);
    expect(u1Ledger).toHaveLength(1);
    expect(u1Ledger[0].userId).toBe(u1.id);
  });
});
