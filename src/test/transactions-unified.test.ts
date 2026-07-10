/**
 * Unified Transactions API for the SettleUp page.
 *
 * Returns every transaction that costs or paid money for this event:
 *   - Per-game payments (live `PlayerPayment` + historical `paymentsSnapshot`)
 *   - Monthly subscriptions (`MonthlySubscription`)
 *   - One-off organizer spends (`ExtrasDeclaration`)
 *
 * Optional query params:
 *   type   — filter to one of "game" | "subscription" | "spend"
 *   from, to — ISO date range filter on the transaction date
 *
 * Auth: owner/admin only — the SettleUp page is the organizer's view.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET } from "~/pages/api/events/[id]/settle/transactions";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

const mockCheckOwnership = vi.mocked(checkOwnership);
const mockGetSession = vi.mocked(getSession);

async function makeEvent() {
  const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "o@t.com", emailVerified: true } });
  const event = await prisma.event.create({
    data: {
      id: "evt-1",
      title: "Game",
      dateTime: new Date("2026-06-15T20:00:00Z"),
      ownerId: owner.id,
      maxPlayers: 10,
      location: "Field",
      eventCost: { create: { totalAmount: 60, currency: "EUR" } },
    },
  });
  return { event, owner };
}

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.extrasDeclaration.deleteMany();
  await prisma.monthlySubscription.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
  mockGetSession.mockResolvedValue({ user: { id: "u-owner" }, session: {} } as any);
});

describe("GET /settle/transactions — unified view", () => {
  it("returns game payments (live + historical) as type=game", async () => {
    const { event } = await makeEvent();
    // 2 live pending payments + 1 paid
    const ec = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
    await prisma.playerPayment.createMany({
      data: [
        { eventCostId: ec!.id, playerName: "Pai", amount: 6, status: "pending" },
        { eventCostId: ec!.id, playerName: "José", amount: 6, status: "paid", paidAt: new Date() },
      ],
    });
    // 1 historical game with a pending entry
    await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: new Date("2026-05-01T20:00:00Z"),
        status: "played",
        teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: JSON.stringify([{ team: "A", players: [{ name: "Elena", order: 0 }] }]),
        paymentsSnapshot: JSON.stringify([{ playerName: "Elena", amount: 6, status: "pending" }]),
        editableUntil: new Date("2026-05-08T20:00:00Z"),
      },
    });

    const req = new Request("http://localhost/api/events/evt-1/settle/transactions?type=game");
    const res = await GET({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toHaveLength(3);
    for (const tx of body.transactions) {
      expect(tx.type).toBe("game");
    }
    // Each entry has the unified shape
    for (const tx of body.transactions) {
      expect(tx).toHaveProperty("id");
      expect(tx).toHaveProperty("date");
      expect(tx).toHaveProperty("description");
      expect(tx).toHaveProperty("amountCents");
      expect(tx).toHaveProperty("currency");
      expect(tx).toHaveProperty("status");
    }
  });

  it("returns monthly subscriptions as type=subscription", async () => {
    const { event } = await makeEvent();
    await prisma.eventCost.update({
      where: { eventId: event.id },
      data: { monthlyEnabled: true, monthlyFeeCents: 3000, monthlyGamesCovered: 5 },
    });
    const pai = await prisma.user.create({ data: { id: "u-pai", name: "Pai", email: "p@t.com", emailVerified: true } });
    await prisma.monthlySubscription.create({
      data: {
        eventId: event.id, userId: pai.id, mode: "monthly",
        windowStart: new Date("2026-06-01T00:00:00Z"),
        windowEnd: new Date("2026-07-01T00:00:00Z"),
        feeCents: 3000, gamesCovered: 5, status: "active",
      },
    });

    const req = new Request("http://localhost/api/events/evt-1/settle/transactions?type=subscription");
    const res = await GET({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].type).toBe("subscription");
    expect(body.transactions[0].description).toMatch(/Pai/);
    expect(body.transactions[0].amountCents).toBe(3000);
    expect(body.transactions[0].status).toBe("active");
  });

  it("returns organizer-declared spends as type=spend", async () => {
    const { event, owner } = await makeEvent();
    await prisma.extrasDeclaration.create({
      data: {
        eventId: event.id, amountCents: 1500, currency: "EUR",
        label: "Bought balls", declaredBy: owner.id,
      },
    });

    const req = new Request("http://localhost/api/events/evt-1/settle/transactions?type=spend");
    const res = await GET({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].type).toBe("spend");
    expect(body.transactions[0].description).toBe("Bought balls");
    expect(body.transactions[0].amountCents).toBe(1500);
  });

  it("returns all types when no type filter is provided", async () => {
    const { event, owner } = await makeEvent();
    await prisma.eventCost.update({
      where: { eventId: event.id },
      data: { monthlyEnabled: true, monthlyFeeCents: 3000, monthlyGamesCovered: 5 },
    });
    const ec = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
    await prisma.playerPayment.create({
      data: { eventCostId: ec!.id, playerName: "Pai", amount: 6, status: "pending" },
    });
    const pai = await prisma.user.create({ data: { id: "u-pai", name: "Pai", email: "p@t.com", emailVerified: true } });
    await prisma.monthlySubscription.create({
      data: {
        eventId: event.id, userId: pai.id, mode: "monthly",
        windowStart: new Date("2026-06-01T00:00:00Z"),
        windowEnd: new Date("2026-07-01T00:00:00Z"),
        feeCents: 3000, gamesCovered: 5, status: "active",
      },
    });
    await prisma.extrasDeclaration.create({
      data: {
        eventId: event.id, amountCents: 1500, currency: "EUR",
        label: "Bought balls", declaredBy: owner.id,
      },
    });

    const req = new Request("http://localhost/api/events/evt-1/settle/transactions");
    const res = await GET({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    // 1 game + 1 subscription + 1 spend
    expect(body.transactions).toHaveLength(3);
    const types = new Set(body.transactions.map((t: any) => t.type));
    expect(types).toEqual(new Set(["game", "subscription", "spend"]));
  });

  it("falls back to the per-user view (empty list) for non-admin callers", async () => {
    // Non-admin callers get their own (empty) wallet ledger, NOT the
    // unified event view. The SettleUp page is admin/owner only and the
    // page guard ensures the unified view is only requested by those roles.
    const { event } = await makeEvent();
    const ec = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
    await prisma.playerPayment.create({
      data: { eventCostId: ec!.id, playerName: "Pai", amount: 6, status: "pending" },
    });
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
    const req = new Request("http://localhost/api/events/evt-1/settle/transactions");
    const res = await GET({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toEqual([]); // per-user view, no userId → empty
  });

  it("returns debt settlements (payment_received WalletTransactions) as type=settlement", async () => {
    const { event } = await makeEvent();
    const pai = await prisma.user.create({ data: { id: "u-pai", name: "Pai", email: "p@t.com", emailVerified: true } });
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id,
        userId: pai.id,
        amountCents: 600,
        currency: "EUR",
        direction: "credit",
        reason: "payment_received",
        statusAfter: "paid",
        playerName: "Pai",
      },
    });

    const req = new Request("http://localhost/api/events/evt-1/settle/transactions?type=settlement");
    const res = await GET({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].type).toBe("settlement");
    expect(body.transactions[0].description).toMatch(/Pai/);
    expect(body.transactions[0].amountCents).toBe(600);
  });
});
