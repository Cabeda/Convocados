import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { PUT } from "~/pages/api/events/[id]/payments/bulk";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockCheckOwnership = vi.mocked(checkOwnership);

beforeEach(async () => {
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
});

describe("PUT /api/events/[id]/payments/bulk", () => {
  it("marks all pending and sent payments as paid", async () => {
    const owner = await prisma.user.create({ data: { id: "u1", name: "Owner", email: "o@t.com", emailVerified: true } });
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Game", dateTime: new Date(), ownerId: owner.id, maxPlayers: 10, location: "Field" },
    });
    const cost = await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 50, currency: "EUR" } });
    await prisma.playerPayment.createMany({
      data: [
        { eventCostId: cost.id, playerName: "A", amount: 5, status: "pending" },
        { eventCostId: cost.id, playerName: "B", amount: 5, status: "sent" },
        { eventCostId: cost.id, playerName: "C", amount: 5, status: "paid", paidAt: new Date() },
      ],
    });

    const req = new Request("http://localhost/api/events/evt-1/payments/bulk", { method: "PUT" });
    const res = await PUT({ params: { id: "evt-1" }, request: req } as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.updated).toBe(2); // A and B, not C (already paid)

    const payments = await prisma.playerPayment.findMany({ where: { eventCostId: cost.id } });
    expect(payments.every((p) => p.status === "paid")).toBe(true);
    expect(payments.every((p) => p.paidAt !== null)).toBe(true);
  });

  it("returns 403 for non-owner/admin", async () => {
    const owner = await prisma.user.create({ data: { id: "u1", name: "Owner", email: "o@t.com", emailVerified: true } });
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Game", dateTime: new Date(), ownerId: owner.id, maxPlayers: 10, location: "Field" },
    });
    await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 50, currency: "EUR" } });

    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const req = new Request("http://localhost/api/events/evt-1/payments/bulk", { method: "PUT" });
    const res = await PUT({ params: { id: "evt-1" }, request: req } as any);

    expect(res.status).toBe(403);
  });

  it("returns 404 when no cost set", async () => {
    await prisma.event.create({
      data: { id: "evt-1", title: "Game", dateTime: new Date(), maxPlayers: 10, location: "Field" },
    });

    const req = new Request("http://localhost/api/events/evt-1/payments/bulk", { method: "PUT" });
    const res = await PUT({ params: { id: "evt-1" }, request: req } as any);

    expect(res.status).toBe(404);
  });
});
