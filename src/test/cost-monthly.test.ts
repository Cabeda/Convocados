import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock the auth helper so we can simulate being the owner.
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: true }),
  checkEventAdmin: vi.fn().mockResolvedValue(true),
}));

import { PUT as setCost, GET as getCost } from "~/pages/api/events/[id]/cost";

function putCtx(params: Record<string, string>, body: unknown) {
  return {
    request: new Request("http://localhost/api/test", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  } as any;
}

async function seedEvent() {
  return prisma.event.create({
    data: {
      title: "Cost Test",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
    },
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.playerPayment.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.event.deleteMany();
});

describe("PUT /api/events/[id]/cost — monthly & drop-in fields", () => {
  it("accepts and stores monthlyEnabled, monthlyFeeCents, monthlyGamesCovered, dropInSurchargeCents", async () => {
    const event = await seedEvent();
    const res = await setCost(putCtx({ id: event.id }, {
      totalAmount: 50,
      currency: "EUR",
      monthlyEnabled: true,
      monthlyFeeCents: 2000,
      monthlyGamesCovered: 5,
      dropInSurchargeCents: 50,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.monthlyEnabled).toBe(true);
    expect(body.monthlyFeeCents).toBe(2000);
    expect(body.monthlyGamesCovered).toBe(5);
    expect(body.dropInSurchargeCents).toBe(50);

    const stored = await prisma.eventCost.findUnique({ where: { eventId: event.id } });
    expect(stored?.monthlyEnabled).toBe(true);
    expect(stored?.monthlyFeeCents).toBe(2000);
    expect(stored?.dropInSurchargeCents).toBe(50);
  });

  it("rejects monthlyFeeCents that is not a positive integer", async () => {
    const event = await seedEvent();
    const res = await setCost(putCtx({ id: event.id }, {
      totalAmount: 50,
      monthlyEnabled: true,
      monthlyFeeCents: -100,
    }));
    expect(res.status).toBe(400);
  });

  it("rejects monthlyGamesCovered <= 0", async () => {
    const event = await seedEvent();
    const res = await setCost(putCtx({ id: event.id }, {
      totalAmount: 50,
      monthlyEnabled: true,
      monthlyFeeCents: 2000,
      monthlyGamesCovered: 0,
    }));
    expect(res.status).toBe(400);
  });

  it("rejects dropInSurchargeCents < 0", async () => {
    const event = await seedEvent();
    const res = await setCost(putCtx({ id: event.id }, {
      totalAmount: 50,
      dropInSurchargeCents: -1,
    }));
    expect(res.status).toBe(400);
  });

  it("returns the new fields from GET", async () => {
    const event = await seedEvent();
    await setCost(putCtx({ id: event.id }, {
      totalAmount: 50,
      monthlyEnabled: true,
      monthlyFeeCents: 2000,
      monthlyGamesCovered: 5,
      dropInSurchargeCents: 50,
    }));
    const res = await getCost({ request: new Request("http://localhost/api/test"), params: { id: event.id } } as any);
    const body = await res.json();
    expect(body.monthlyEnabled).toBe(true);
    expect(body.monthlyFeeCents).toBe(2000);
    expect(body.dropInSurchargeCents).toBe(50);
  });
});
