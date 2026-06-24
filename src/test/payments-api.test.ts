import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as AuthHelpersServer from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";
import { GET, PUT } from "~/pages/api/events/[id]/payments";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof AuthHelpersServer>("~/lib/auth.helpers.server");
  return {
    ...actual,
    checkOwnership: vi.fn(),
  };
});

beforeEach(async () => {
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function getCtx(eventId: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/payments`, { method: "GET" }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/payments`),
  } as any;
}

function putCtx(eventId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/payments`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/payments`),
  } as any;
}

async function seedUser(id = "user-pay-1") {
  return prisma.user.create({
    data: { id, name: "Payment User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(ownerId: string, id = "evt-pay-1") {
  return prisma.event.create({
    data: { id, title: "Payment Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId },
  });
}

describe("GET /api/events/[id]/payments", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await GET(getCtx("non-existent"));
    expect(res.status).toBe(404);
  });

  it("returns empty payments when no cost is set", async () => {
    const user = await seedUser();
    const event = await seedEvent(user.id);

    const res = await GET(getCtx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments).toEqual([]);
    expect(body.summary.totalCount).toBe(0);
  });

  it("returns payments with summary", async () => {
    const user = await seedUser();
    const event = await seedEvent(user.id);
    const eventCost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
    });
    await prisma.playerPayment.createMany({
      data: [
        { eventCostId: eventCost.id, playerName: "Alice", amount: 10, status: "paid" },
        { eventCostId: eventCost.id, playerName: "Bob", amount: 10, status: "pending" },
      ],
    });

    const res = await GET(getCtx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments).toHaveLength(2);
    expect(body.summary.paidCount).toBe(1);
    expect(body.summary.pendingCount).toBe(1);
    expect(body.summary.totalCount).toBe(2);
    expect(body.summary.paidAmount).toBe(10);
  });
});

describe("PUT /api/events/[id]/payments", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await PUT(putCtx("non-existent", { playerName: "Alice", status: "paid" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx(event.id, { playerName: "Alice", status: "paid" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when no cost is set", async () => {
    const owner = await seedUser("owner-2");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx(event.id, { playerName: "Alice", status: "paid" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid status", async () => {
    const owner = await seedUser("owner-3");
    const event = await seedEvent(owner.id);
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx(event.id, { playerName: "Alice", status: "invalid" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent player payment", async () => {
    const owner = await seedUser("owner-4");
    const event = await seedEvent(owner.id);
    await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx(event.id, { playerName: "NonExistent", status: "paid" }));
    expect(res.status).toBe(404);
  });

  it("updates payment status to paid", async () => {
    const owner = await seedUser("owner-5");
    const event = await seedEvent(owner.id);
    const eventCost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: eventCost.id, playerName: "Alice", amount: 10, status: "pending" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx(event.id, { playerName: "Alice", status: "paid" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("paid");
    expect(body.paidAt).not.toBeNull();
  });

  it("updates payment status to pending", async () => {
    const owner = await seedUser("owner-6");
    const event = await seedEvent(owner.id);
    const eventCost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: eventCost.id, playerName: "Bob", amount: 10, status: "paid", paidAt: new Date() },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx(event.id, { playerName: "Bob", status: "pending" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.paidAt).toBeNull();
  });

  it("updates payment with method", async () => {
    const owner = await seedUser("owner-7");
    const event = await seedEvent(owner.id);
    const eventCost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: eventCost.id, playerName: "Charlie", amount: 10, status: "pending" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx(event.id, { playerName: "Charlie", status: "paid", method: "MBWay" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("MBWay");
  });

  it("does not write the literal string 'undefined' when method is absent", async () => {
    const owner = await seedUser("owner-7b");
    const event = await seedEvent(owner.id);
    const eventCost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: eventCost.id, playerName: "Dora", amount: 10, status: "pending", method: "Cash" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    // No `method` field in the body — should leave the existing method untouched.
    const res = await PUT(putCtx(event.id, { playerName: "Dora", status: "paid" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("Cash");
    expect(body.method).not.toBe("undefined");
  });

  it("clears the method when explicitly set to null", async () => {
    const owner = await seedUser("owner-7c");
    const event = await seedEvent(owner.id);
    const eventCost = await prisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
    });
    await prisma.playerPayment.create({
      data: { eventCostId: eventCost.id, playerName: "Eli", amount: 10, status: "pending", method: "Cash" },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx(event.id, { playerName: "Eli", status: "paid", method: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBeNull();
  });
});
