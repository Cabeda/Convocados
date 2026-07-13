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

import { GET as usersGet } from "~/pages/api/events/[id]/rsvp/users";

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/apiRateLimit.server", () => ({
  rateLimitResponse: vi.fn().mockResolvedValue(null),
}));

beforeEach(async () => {
  await testPrisma.rsvp.deleteMany();
  await testPrisma.eventFollow.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
  vi.clearAllMocks();
});

function ctx(eventId: string, session: { user: { id: string; name: string } } | null) {
  mockGetSession.mockResolvedValue(session as any);
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/rsvp/users`),
  } as any;
}

async function seedEvent(ownerId: string | null) {
  const event = await testPrisma.event.create({
    data: {
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 7 * 86400_000),
      ownerId,
    },
  });
  const game = await testPrisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  await testPrisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

describe("GET /api/events/[id]/rsvp/users", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await usersGet(ctx("nope", { user: { id: "u1", name: "U" } }));
    expect(res.status).toBe(404);
  });

  it("returns empty map for anonymous viewer (one-way privacy)", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const other = await testPrisma.user.create({ data: { id: "other", name: "X", email: "x@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const epOther = await testPrisma.eventPlayer.create({ data: { eventId: ev.id, name: "X", userId: other.id } });
    await testPrisma.rsvp.create({ data: { eventPlayerId: epOther.id, gameId: ev.currentGameId!, status: "yes", respondedAt: new Date() } });

    const res = await usersGet(ctx(ev.id, null));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual({});
  });

  it("returns RSVP map of all linked-user RSVPs for a logged viewer", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const a = await testPrisma.user.create({ data: { id: "a", name: "A", email: "a@t.com", emailVerified: true } });
    const b = await testPrisma.user.create({ data: { id: "b", name: "B", email: "b@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const epA = await testPrisma.eventPlayer.create({ data: { eventId: ev.id, name: "A", userId: a.id } });
    const epB = await testPrisma.eventPlayer.create({ data: { eventId: ev.id, name: "B", userId: b.id } });
    await testPrisma.rsvp.create({ data: { eventPlayerId: epA.id, gameId: ev.currentGameId!, status: "yes", respondedAt: new Date() } });
    await testPrisma.rsvp.create({ data: { eventPlayerId: epB.id, gameId: ev.currentGameId!, status: "maybe", respondedAt: new Date() } });

    const res = await usersGet(ctx(ev.id, { user: { id: owner.id, name: "O" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual({ a: "yes", b: "maybe" });
  });

  it("excludes guest (playerId-keyed) RSVPs from the user map", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const _guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "G", order: 0 } });
    const epGuest = await testPrisma.eventPlayer.create({ data: { eventId: ev.id, name: "G" } });
    await testPrisma.rsvp.create({ data: { eventPlayerId: epGuest.id, gameId: ev.currentGameId!, status: "yes", respondedAt: new Date() } });

    const res = await usersGet(ctx(ev.id, { user: { id: owner.id, name: "O" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual({});
  });
});
