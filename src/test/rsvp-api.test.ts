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

import { POST as rsvpPost, GET as rsvpGet } from "~/pages/api/events/[id]/rsvp";

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: async (request: Request, ownerId: string | null, existingSession?: any) => {
    const session = existingSession ?? await mockGetSession(request);
    const isOwner = !!(session?.user && ownerId && session.user.id === ownerId);
    return { isOwner, session };
  },
}));

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
  await testPrisma.eventFollow.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
  vi.clearAllMocks();
});

function ctx(eventId: string, body: unknown, session: { user: { id: string; name: string } } | null) {
  mockGetSession.mockResolvedValue(session as any);
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any;
}

function getCtx(eventId: string, session: { user: { id: string; name: string } } | null) {
  mockGetSession.mockResolvedValue(session as any);
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/rsvp`, { method: "GET" }),
  } as any;
}

async function seedEvent(dateOffsetMs: number) {
  return testPrisma.event.create({
    data: {
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + dateOffsetMs),
      ownerId: null,
    },
  });
}

describe("POST /api/events/[id]/rsvp", () => {
  it("returns 401 when not authenticated", async () => {
    const ev = await seedEvent(7 * 86400_000);
    const res = await rsvpPost(ctx(ev.id, { status: "yes" }, null));
    expect(res.status).toBe(401);
  });

  it("accepts 'maybe' status", async () => {
    const ev = await seedEvent(7 * 86400_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    const user = { user: { id: "u1", name: "U" } };
    const res = await rsvpPost(ctx(ev.id, { status: "maybe" }, user));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("maybe");
  });

  it("rejects truly invalid status", async () => {
    const ev = await seedEvent(7 * 86400_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    const user = { user: { id: "u1", name: "U" } };
    const res = await rsvpPost(ctx(ev.id, { status: "wat" }, user));
    expect(res.status).toBe(400);
  });

  it("upserts and returns 200", async () => {
    const ev = await seedEvent(7 * 86400_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    const user = { user: { id: "u1", name: "U" } };
    const res = await rsvpPost(ctx(ev.id, { status: "yes" }, user));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("yes");
  });

  it("is idempotent (upsert on userId+eventId)", async () => {
    const ev = await seedEvent(7 * 86400_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    const user = { user: { id: "u1", name: "U" } };
    await rsvpPost(ctx(ev.id, { status: "yes" }, user));
    const res = await rsvpPost(ctx(ev.id, { status: "no" }, user));
    const body = await res.json();
    expect(body.status).toBe("no");
    const count = await testPrisma.rsvp.count({ where: { eventId: ev.id, userId: "u1" } });
    expect(count).toBe(1);
  });

  it("refuses after kickoff", async () => {
    const ev = await seedEvent(-60_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    const user = { user: { id: "u1", name: "U" } };
    const res = await rsvpPost(ctx(ev.id, { status: "yes" }, user));
    expect(res.status).toBe(409);
  });

  it("returns 422 when Idempotency-Key is reused with a different payload", async () => {
    const ev = await seedEvent(7 * 86400_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    const user = { user: { id: "u1", name: "U" } };

    // Seed a conflicting idempotency entry by doing a first request with the key + status=yes.
    mockGetSession.mockResolvedValue(user as any);
    const firstReq = new Request(`http://localhost/api/events/${ev.id}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "key-1" },
      body: JSON.stringify({ status: "yes" }),
    });
    const firstRes = await rsvpPost({ params: { id: ev.id }, request: firstReq } as any);
    expect(firstRes.status).toBe(200);

    // Reuse the same key with a different payload.
    const secondReq = new Request(`http://localhost/api/events/${ev.id}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "key-1" },
      body: JSON.stringify({ status: "no" }),
    });
    const secondRes = await rsvpPost({ params: { id: ev.id }, request: secondReq } as any);
    expect(secondRes.status).toBe(422);
  });

  it("replays the cached response on same key + same payload", async () => {
    const ev = await seedEvent(7 * 86400_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    const user = { user: { id: "u1", name: "U" } };
    mockGetSession.mockResolvedValue(user as any);

    const firstReq = new Request(`http://localhost/api/events/${ev.id}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "key-replay" },
      body: JSON.stringify({ status: "yes" }),
    });
    const firstRes = await rsvpPost({ params: { id: ev.id }, request: firstReq } as any);
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();

    // Manually flip the DB row to a different status — replay should still return the original.
    await testPrisma.rsvp.update({
      where: { userId_eventId: { userId: "u1", eventId: ev.id } },
      data: { status: "no" },
    });

    const secondReq = new Request(`http://localhost/api/events/${ev.id}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "key-replay" },
      body: JSON.stringify({ status: "yes" }),
    });
    const secondRes = await rsvpPost({ params: { id: ev.id }, request: secondReq } as any);
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody).toEqual(firstBody);
  });
});

describe("GET /api/events/[id]/rsvp", () => {
  it("returns null when no row", async () => {
    const ev = await seedEvent(7 * 86400_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    const res = await rsvpGet(getCtx(ev.id, { user: { id: "u1", name: "U" } }));
    const body = await res.json();
    expect(body.status).toBeNull();
  });

  it("returns stored status", async () => {
    const ev = await seedEvent(7 * 86400_000);
    await testPrisma.user.create({ data: { id: "u1", name: "U", email: "u1@t.com", emailVerified: true } });
    await testPrisma.rsvp.create({ data: { eventId: ev.id, userId: "u1", status: "yes", respondedAt: new Date() } });
    const res = await rsvpGet(getCtx(ev.id, { user: { id: "u1", name: "U" } }));
    const body = await res.json();
    expect(body.status).toBe("yes");
  });
});
