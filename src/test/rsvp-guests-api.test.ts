import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

import { GET as guestsGet } from "~/pages/api/events/[id]/rsvp/guests";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/apiRateLimit.server", () => ({
  rateLimitResponse: vi.fn().mockResolvedValue(null),
  resetApiRateLimitStore: vi.fn(),
}));

beforeEach(async () => {
  await testPrisma.rsvp.deleteMany();
  await testPrisma.eventAdmin.deleteMany();
  await testPrisma.eventFollow.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
});

function ctx(eventId: string) {
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/rsvp/guests`),
  } as any;
}

describe("GET /api/events/[id]/rsvp/guests", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await guestsGet(ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("returns an empty map for an event with no guests", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await testPrisma.event.create({
      data: { title: "G", location: "P", dateTime: new Date(Date.now() + 86400_000), ownerId: owner.id },
    });
    const res = await guestsGet(ctx(ev.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guests).toEqual({});
  });

  it("returns the RSVP status of every active guest (linked players and archived players excluded)", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const linked = await testPrisma.user.create({ data: { id: "linked", name: "L", email: "l@t.com", emailVerified: true } });
    const ev = await testPrisma.event.create({
      data: { title: "G", location: "P", dateTime: new Date(Date.now() + 86400_000), ownerId: owner.id },
    });

    const g1 = await testPrisma.player.create({ data: { eventId: ev.id, name: "G1", order: 0 } });
    const g2 = await testPrisma.player.create({ data: { eventId: ev.id, name: "G2", order: 1 } });
    const archived = await testPrisma.player.create({
      data: { eventId: ev.id, name: "Arch", order: 2, archivedAt: new Date() },
    });
    const linkedPlayer = await testPrisma.player.create({
      data: { eventId: ev.id, name: "L", userId: linked.id, order: 3 },
    });

    await testPrisma.rsvp.create({ data: { eventId: ev.id, playerId: g1.id, status: "yes", respondedAt: new Date() } });
    await testPrisma.rsvp.create({ data: { eventId: ev.id, playerId: g2.id, status: "no", respondedAt: new Date() } });
    await testPrisma.rsvp.create({ data: { eventId: ev.id, playerId: archived.id, status: "yes", respondedAt: new Date() } });
    await testPrisma.rsvp.create({ data: { eventId: ev.id, userId: linked.id, status: "yes", respondedAt: new Date() } });

    const res = await guestsGet(ctx(ev.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guests).toEqual({
      [g1.id]: "yes",
      [g2.id]: "no",
      // archived and linked are NOT in the response
    });
    expect(body.guests[archived.id]).toBeUndefined();
    expect(body.guests[linkedPlayer.id]).toBeUndefined();
  });
});
