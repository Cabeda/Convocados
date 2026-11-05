import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/payments/settlement/bulk-undo";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

beforeEach(async () => {
  await prisma.gamePayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
});

describe("POST /api/events/[id]/payments/settlement/bulk-undo", () => {
  it("returns 404 for missing event", async () => {
    const req = new Request("http://localhost/api/events/nope/payments/settlement/bulk-undo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: "g", eventPlayerIds: ["ep"] }),
    });
    const res = await POST({ params: { id: "nope" }, request: req } as any);
    expect(res.status).toBe(404);
  });

  it("reverts nothing gracefully for an ownerless unlocked event", async () => {
    const event = await prisma.event.create({
      data: { title: "E", location: "P", dateTime: new Date(), maxPlayers: 10, ownerId: null, isPublic: false },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(), status: "upcoming" } });
    const req = new Request(`http://localhost/api/events/${event.id}/payments/settlement/bulk-undo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: game.id, eventPlayerIds: ["ep-missing"] }),
    });
    const res = await POST({ params: { id: event.id }, request: req } as any);
    expect([200, 400]).toContain(res.status);
  });
});

describe("POST /api/events/[id]/payments/settlement/bulk-undo (locked)", () => {
  it("returns 403 for a password-locked event without access", async () => {
    const event = await prisma.event.create({
      data: { title: "E", location: "P", dateTime: new Date(), maxPlayers: 10, ownerId: null, isPublic: false, accessPassword: "hashed" },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(), status: "upcoming" } });
    const req = new Request(`http://localhost/api/events/${event.id}/payments/settlement/bulk-undo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: game.id, eventPlayerIds: ["ep"] }),
    });
    const res = await POST({ params: { id: event.id }, request: req } as any);
    expect(res.status).toBe(403);
  });
});
