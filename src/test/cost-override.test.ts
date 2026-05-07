import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { PUT, DELETE } from "~/pages/api/events/[id]/cost/override";
import { getSession, checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockGetSession = vi.mocked(getSession);
const mockCheckOwnership = vi.mocked(checkOwnership);

beforeEach(async () => {
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: "u1", name: "Owner" } } as any);
  mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
});

function ctx(eventId: string, body: any, method = "PUT") {
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/cost/override`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any;
}

async function seedEventWithCost() {
  const user = await prisma.user.create({
    data: { id: "u1", name: "Owner", email: "o@t.com", emailVerified: true },
  });
  const event = await prisma.event.create({
    data: { title: "Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId: user.id },
  });
  const cost = await prisma.eventCost.create({
    data: { eventId: event.id, totalAmount: 50, currency: "EUR" },
  });
  return { user, event, cost };
}

describe("PUT /api/events/[id]/cost/override", () => {
  it("returns 404 when event not found", async () => {
    const res = await PUT(ctx("nonexistent", { paymentMethods: null }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when not owner or admin", async () => {
    const { event } = await seedEventWithCost();
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
    const res = await PUT(ctx(event.id, { paymentMethods: null }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when no cost set", async () => {
    const user = await prisma.user.create({
      data: { id: "u2", name: "User", email: "u2@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "NoCost", location: "L", dateTime: new Date(), maxPlayers: 10, ownerId: user.id },
    });
    const res = await PUT(ctx(event.id, { paymentMethods: null }));
    expect(res.status).toBe(404);
  });

  it("sets payment method override", async () => {
    const { event } = await seedEventWithCost();
    const res = await PUT(ctx(event.id, {
      paymentMethods: [{ type: "mbway", value: "912345678" }],
      paymentDetails: "Pay before game",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("clears override when paymentMethods is empty array", async () => {
    const { event } = await seedEventWithCost();
    const res = await PUT(ctx(event.id, { paymentMethods: [] }));
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid payment methods", async () => {
    const { event } = await seedEventWithCost();
    const res = await PUT(ctx(event.id, { paymentMethods: [{ type: "invalid" }] }));
    expect(res.status).toBe(400);
  });

  it("handles null paymentDetails", async () => {
    const { event } = await seedEventWithCost();
    const res = await PUT(ctx(event.id, { paymentMethods: null, paymentDetails: null }));
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/events/[id]/cost/override", () => {
  it("returns 404 when event not found", async () => {
    const res = await DELETE(ctx("nonexistent", {}, "DELETE"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when not owner or admin", async () => {
    const { event } = await seedEventWithCost();
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
    const res = await DELETE(ctx(event.id, {}, "DELETE"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when no cost set", async () => {
    const user = await prisma.user.create({
      data: { id: "u3", name: "User", email: "u3@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "NoCost", location: "L", dateTime: new Date(), maxPlayers: 10, ownerId: user.id },
    });
    const res = await DELETE(ctx(event.id, {}, "DELETE"));
    expect(res.status).toBe(404);
  });

  it("clears override successfully", async () => {
    const { event } = await seedEventWithCost();
    const res = await DELETE(ctx(event.id, {}, "DELETE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
