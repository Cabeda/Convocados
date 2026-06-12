import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { getSession, checkOwnership } from "~/lib/auth.helpers.server";
const mockGetSession = vi.mocked(getSession);
const mockCheckOwnership = vi.mocked(checkOwnership);

import { GET as getSettle, POST as postSettle } from "~/pages/api/events/[id]/settle";
import { GET as getTransactions } from "~/pages/api/events/[id]/settle/transactions";
import {
  GET as getExtras,
  POST as postExtras,
} from "~/pages/api/events/[id]/settle/extras";
import { POST as postSubscription } from "~/pages/api/events/[id]/settle/subscriptions";
import { DELETE as deleteSubscription } from "~/pages/api/events/[id]/settle/subscriptions/[subId]";

function getCtx(params: Record<string, string>, query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/test");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return {
    request: new Request(url.toString()),
    params,
  } as any;
}

function postCtx(params: Record<string, string>, body: unknown) {
  return {
    request: new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  } as any;
}

function deleteCtx(params: Record<string, string>) {
  return { request: new Request("http://localhost/api/test", { method: "DELETE" }), params } as any;
}

async function seedEventWithCost(opts: {
  monthlyEnabled?: boolean;
  monthlyFeeCents?: number;
  extras?: number;
  ownerId?: string | null;
} = {}) {
  return prisma.event.create({
    data: {
      title: "Settle Test",
      location: "Pitch",
      dateTime: new Date("2026-06-15T20:00:00Z"),
      timezone: "UTC",
      ownerId: opts.ownerId ?? null,
      eventCost: {
        create: {
          totalAmount: 50,
          currency: "EUR",
          monthlyEnabled: opts.monthlyEnabled ?? false,
          monthlyFeeCents: opts.monthlyFeeCents ?? null,
          monthlyGamesCovered: 5,
          organizerExtrasCents: opts.extras ?? 0,
        },
      },
    },
    include: { eventCost: true },
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.extrasDeclaration.deleteMany();
  await prisma.monthlySubscription.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

describe("GET /api/events/[id]/settle", () => {
  it("returns the public extras pot for unauthenticated callers", async () => {
    mockGetSession.mockResolvedValue(null);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const event = await seedEventWithCost({ extras: 1500 });
    const res = await getSettle(getCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.extras.potCents).toBe(1500);
    expect(body.extras.currency).toBe("EUR");
  });

  it("includes the caller's balance and ledger when authenticated", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const alice = await prisma.user.create({ data: { id: "alice-1", name: "Alice", email: "alice@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id });
    await prisma.player.create({ data: { name: "Alice", eventId: event.id, userId: alice.id, order: 0 } });
    await prisma.playerPayment.create({
      data: { eventCostId: event.eventCost!.id, playerName: "Alice", amount: 5, status: "pending" },
    });
    // Seed wallet transactions so the map branches execute (covers
    // per_game_share, missed_game_credit, and credit_expired reasons).
    await prisma.walletTransaction.create({
      data: { eventId: event.id, userId: alice.id, amountCents: 500, currency: "EUR", direction: "debit", gameUnits: 0, reason: "per_game_share" },
    });
    await prisma.walletTransaction.create({
      data: { eventId: event.id, userId: alice.id, amountCents: 500, currency: "EUR", direction: "credit", gameUnits: 1, reason: "missed_game_credit" },
    });
    await prisma.walletTransaction.create({
      data: { eventId: event.id, userId: alice.id, amountCents: 500, currency: "EUR", direction: "credit", gameUnits: -1, reason: "credit_expired" },
    });
    mockGetSession.mockResolvedValue({ user: { id: alice.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });

    const res = await getSettle(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.you).toBeDefined();
    expect(body.you.playerName).toBe("Alice");
    expect(body.you.balanceCents).toBe(500);
    expect(body.you.transactions).toHaveLength(3);
    expect(body.you.availableGameUnits).toBe(0); // 1 earned, 1 expired
    expect(body.you.walletRunningTotal).toBe(0);
  });

  it("includes admin breakdown (balances + subscriptions) for owner", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });

    const res = await getSettle(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.admin).toBeDefined();
    expect(body.admin.aggregate).toBeDefined();
    expect(body.admin.subscriptions).toEqual([]);
  });

  it("returns 404 for non-existent event", async () => {
    mockGetSession.mockResolvedValue(null);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const res = await getSettle(getCtx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("uses defaults for pot/currency when the event has no cost", async () => {
    mockGetSession.mockResolvedValue(null);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const event = await prisma.event.create({ data: { title: "NoCost", location: "X", dateTime: new Date() } });
    const res = await getSettle(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.extras.potCents).toBe(0);
    expect(body.extras.currency).toBe("EUR");
  });

  it("includes activeSubscription when the player has one for the current month", async () => {
    const alice = await prisma.user.create({ data: { id: "alice-1", name: "Alice", email: "alice@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ monthlyEnabled: true, monthlyFeeCents: 2000 });
    await prisma.player.create({ data: { name: "Alice", eventId: event.id, userId: alice.id, order: 0 } });
    const { subscriptionWindowFor } = await import("~/lib/monthly");
    const win = subscriptionWindowFor(new Date(), "UTC");
    await prisma.monthlySubscription.create({
      data: {
        eventId: event.id, userId: alice.id, mode: "monthly",
        windowStart: win.windowStart, windowEnd: win.windowEnd,
        feeCents: 2000, gamesCovered: 5, status: "active",
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: alice.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });

    const res = await getSettle(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.you.activeSubscription).not.toBeNull();
    expect(body.you.activeSubscription.feeCents).toBe(2000);
    expect(body.you.activeSubscription.gamesCovered).toBe(5);
  });
});

describe("POST /api/events/[id]/settle", () => {
  it("returns 405 Method Not Allowed", async () => {
    mockGetSession.mockResolvedValue(null);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const event = await seedEventWithCost();
    const res = await postSettle(postCtx({ id: event.id }, {}));
    expect(res.status).toBe(405);
  });
});

describe("GET /api/events/[id]/settle/transactions", () => {
  it("returns 401 for unauthenticated", async () => {
    const event = await seedEventWithCost();
    mockGetSession.mockResolvedValue(null);
    const res = await getTransactions(getCtx({ id: event.id }));
    expect(res.status).toBe(401);
  });

  it("returns only the caller's transactions for a regular player", async () => {
    const alice = await prisma.user.create({ data: { id: "alice-1", name: "Alice", email: "alice@settle.test", emailVerified: true } });
    const bob = await prisma.user.create({ data: { id: "bob-1", name: "Bob", email: "bob@settle.test", emailVerified: true } });
    const event = await seedEventWithCost();
    await prisma.walletTransaction.create({ data: { eventId: event.id, userId: alice.id, amountCents: 500, currency: "EUR", direction: "debit", gameUnits: 0, reason: "per_game_share" } });
    await prisma.walletTransaction.create({ data: { eventId: event.id, userId: bob.id, amountCents: 500, currency: "EUR", direction: "debit", gameUnits: 0, reason: "per_game_share" } });

    mockGetSession.mockResolvedValue({ user: { id: alice.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });

    const res = await getTransactions(getCtx({ id: event.id }));
    const body = await res.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].userId).toBe(alice.id);
  });
});

describe("GET /api/events/[id]/settle/extras", () => {
  it("is public-readable and returns the pot + log", async () => {
    const event = await seedEventWithCost({ extras: 2000 });
    await prisma.extrasDeclaration.create({
      data: { eventId: event.id, amountCents: 500, currency: "EUR", label: "ball", declaredBy: "owner" },
    });
    const res = await getExtras(getCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.potCents).toBe(2000);
    expect(body.declarations).toHaveLength(1);
    expect(body.declarations[0].label).toBe("ball");
  });

  it("returns 404 for a non-existent event", async () => {
    const res = await getExtras(getCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("returns defaults for an event with no cost", async () => {
    const event = await prisma.event.create({ data: { title: "NoCost", location: "X", dateTime: new Date() } });
    const res = await getExtras(getCtx({ id: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.potCents).toBe(0);
    expect(body.currency).toBe("EUR");
    expect(body.declarations).toEqual([]);
  });
});

describe("POST /api/events/[id]/settle/extras", () => {
  it("requires owner", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id });
    mockGetSession.mockResolvedValue({ user: { id: "u-other" } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const res = await postExtras(postCtx({ id: event.id }, { amountCents: 500, label: "ball" }));
    expect(res.status).toBe(403);
  });

  it("decrements the pot and writes a declaration + ledger row", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id, extras: 2000 });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });

    const res = await postExtras(postCtx({ id: event.id }, { amountCents: 999, label: "Apple Developer fee" }));
    expect(res.status).toBe(200);

    const after = await prisma.eventCost.findUnique({ where: { id: event.eventCost!.id } });
    expect(after?.organizerExtrasCents).toBe(2000 - 999);

    const decl = await prisma.extrasDeclaration.findFirst({ where: { eventId: event.id } });
    expect(decl?.label).toBe("Apple Developer fee");

    const ledger = await prisma.walletTransaction.findFirst({ where: { eventId: event.id, reason: "extras_declare" } });
    expect(ledger?.amountCents).toBe(999);
    expect(ledger?.direction).toBe("debit");
  });

  it("rejects non-positive amountCents", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
    const res = await postExtras(postCtx({ id: event.id }, { amountCents: 0, label: "x" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/events/[id]/settle/subscriptions", () => {
  it("requires monthlyEnabled", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const target = await prisma.user.create({ data: { id: "target-1", name: "Target", email: "target@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });

    const res = await postSubscription(postCtx({ id: event.id }, { userId: target.id }));
    expect(res.status).toBe(400);
  });

  it("creates a subscription for the current month when monthlyEnabled", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const target = await prisma.user.create({ data: { id: "target-1", name: "Target", email: "target@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id, monthlyEnabled: true, monthlyFeeCents: 2000 });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });

    const res = await postSubscription(postCtx({ id: event.id }, { userId: target.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.status).toBe("active");
    expect(body.subscription.feeCents).toBe(2000);
  });

  it("auto-enrolls the subscriber in PriorityEnrollment (ADR 0008)", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const target = await prisma.user.create({ data: { id: "target-1", name: "Target", email: "target@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id, monthlyEnabled: true, monthlyFeeCents: 2000 });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });

    await postSubscription(postCtx({ id: event.id }, { userId: target.id }));

    const enrollment = await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: target.id } },
    });
    expect(enrollment).not.toBeNull();
    expect(enrollment?.optedIn).toBe(true);
    expect(enrollment?.source).toBe("auto");
  });

  it("rejects a non-owner (403)", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const target = await prisma.user.create({ data: { id: "target-1", name: "Target", email: "target@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id, monthlyEnabled: true, monthlyFeeCents: 2000 });
    mockGetSession.mockResolvedValue({ user: { id: "u-other" } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const res = await postSubscription(postCtx({ id: event.id }, { userId: target.id }));
    expect(res.status).toBe(403);
  });

  it("rejects a missing userId (400)", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id, monthlyEnabled: true, monthlyFeeCents: 2000 });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
    const res = await postSubscription(postCtx({ id: event.id }, {}));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid windowStart (400)", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const target = await prisma.user.create({ data: { id: "target-1", name: "Target", email: "target@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id, monthlyEnabled: true, monthlyFeeCents: 2000 });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
    const res = await postSubscription(postCtx({ id: event.id }, { userId: target.id, windowStart: "not-a-date" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent event", async () => {
    mockGetSession.mockResolvedValue(null);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const res = await postSubscription(postCtx({ id: "missing" }, { userId: "u" }));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/events/[id]/settle/subscriptions/[subId]", () => {
  it("cancels an active subscription", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const target = await prisma.user.create({ data: { id: "target-1", name: "Target", email: "target@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id });
    const sub = await prisma.monthlySubscription.create({
      data: {
        eventId: event.id, userId: target.id, mode: "monthly",
        windowStart: new Date("2026-06-01T00:00:00Z"),
        windowEnd: new Date("2026-07-01T00:00:00Z"),
        feeCents: 2000, gamesCovered: 5, status: "active",
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });

    const res = await deleteSubscription(deleteCtx({ id: event.id, subId: sub.id }));
    expect(res.status).toBe(200);

    const after = await prisma.monthlySubscription.findUnique({ where: { id: sub.id } });
    expect(after?.status).toBe("cancelled");
  });

  it("returns 404 when the subscription doesn't exist", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
    const res = await deleteSubscription(deleteCtx({ id: event.id, subId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-existent event", async () => {
    mockGetSession.mockResolvedValue(null);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const res = await deleteSubscription(deleteCtx({ id: "missing", subId: "x" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner", async () => {
    const owner = await prisma.user.create({ data: { id: "owner-1", name: "Owner", email: "owner@settle.test", emailVerified: true } });
    const target = await prisma.user.create({ data: { id: "target-1", name: "Target", email: "target@settle.test", emailVerified: true } });
    const event = await seedEventWithCost({ ownerId: owner.id });
    const sub = await prisma.monthlySubscription.create({
      data: { eventId: event.id, userId: target.id, mode: "monthly", windowStart: new Date("2026-06-01T00:00:00Z"), windowEnd: new Date("2026-07-01T00:00:00Z"), feeCents: 2000, gamesCovered: 5, status: "active" },
    });
    mockGetSession.mockResolvedValue({ user: { id: "u-other" } } as any);
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const res = await deleteSubscription(deleteCtx({ id: event.id, subId: sub.id }));
    expect(res.status).toBe(403);
  });
});
