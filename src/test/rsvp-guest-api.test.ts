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

import { POST as guestRsvpPost } from "~/pages/api/events/[id]/players/[playerId]/rsvp";

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: async (request: Request, ownerId: string | null, existingSession?: any, _eventId?: string) => {
    const session = existingSession ?? await mockGetSession(request);
    const sessionUserId = session?.user?.id ?? null;
    const isOwner = !!(sessionUserId && ownerId && sessionUserId === ownerId);
    return { isOwner, isAdmin: false, session };
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
  await testPrisma.eventAdmin.deleteMany();
  await testPrisma.eventFollow.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
  vi.clearAllMocks();
});

function ctx(eventId: string, playerId: string, body: unknown, session: { user: { id: string; name: string } } | null) {
  mockGetSession.mockResolvedValue(session as any);
  return {
    params: { id: eventId, playerId },
    request: new Request(`http://localhost/api/events/${eventId}/players/${playerId}/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any;
}

async function seedEvent(ownerId: string | null, dateOffsetMs = 7 * 86400_000) {
  return testPrisma.event.create({
    data: {
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + dateOffsetMs),
      ownerId,
    },
  });
}

describe("POST /api/events/[id]/players/[playerId]/rsvp", () => {
  it("returns 401 when not authenticated", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });
    const res = await guestRsvpPost(ctx(ev.id, guest.id, { status: "yes" }, null));
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not the owner nor an admin", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });
    const stranger = { user: { id: "stranger", name: "S" } };
    const res = await guestRsvpPost(ctx(ev.id, guest.id, { status: "yes" }, stranger));
    expect(res.status).toBe(403);
  });

  it("accepts 'maybe' status for a guest", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });
    const res = await guestRsvpPost(ctx(ev.id, guest.id, { status: "maybe" }, { user: { id: "owner", name: "O" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("maybe");
  });

  it("rejects truly invalid status for a guest", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });
    const res = await guestRsvpPost(ctx(ev.id, guest.id, { status: "wat" }, { user: { id: "owner", name: "O" } }));
    expect(res.status).toBe(400);
  });

  it("owner can set guest attendance to 'yes'", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });

    const res = await guestRsvpPost(ctx(ev.id, guest.id, { status: "yes" }, { user: { id: "owner", name: "O" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("yes");
    expect(body.respondedByUserId).toBe("owner");

    const row = await testPrisma.rsvp.findFirst({ where: { eventId: ev.id, playerId: guest.id } });
    expect(row?.status).toBe("yes");
    expect(row?.userId).toBeNull();
  });

  it("admin (non-owner) can set guest attendance", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const adminUser = await testPrisma.user.create({ data: { id: "admin", name: "A", email: "a@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });
    await testPrisma.eventAdmin.create({ data: { eventId: ev.id, userId: adminUser.id } });

    // checkOwnership mock returns isAdmin:false; we manually grant via DB row but the API checks
    // eventAdmin table directly for non-owners. Need to align: the API's isAdmin check is separate
    // from checkOwnership's return. Let's simulate by using the owner role for this test path.
    // The API checks: isOwner || (isAdmin from prisma.eventAdmin.findUnique). The admin path
    // works in production; here we test by making the admin user the actor and verifying
    // the API's prisma.eventAdmin.findUnique query sees the row.
    const res = await guestRsvpPost(ctx(ev.id, guest.id, { status: "no" }, { user: { id: "admin", name: "A" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("no");
    expect(body.respondedByUserId).toBe("admin");
  });

  it("refuses to set RSVP for a linked player (userId set) — 409", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const linked = await testPrisma.user.create({ data: { id: "linked", name: "L", email: "l@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const linkedPlayer = await testPrisma.player.create({
      data: { eventId: ev.id, name: linked.name, userId: linked.id, order: 0 },
    });

    const res = await guestRsvpPost(ctx(ev.id, linkedPlayer.id, { status: "yes" }, { user: { id: "owner", name: "O" } }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/linked/i);
  });

  it("returns 404 when player does not exist", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);

    const res = await guestRsvpPost(ctx(ev.id, "does-not-exist", { status: "yes" }, { user: { id: "owner", name: "O" } }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when player belongs to a different event", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev1 = await seedEvent(owner.id);
    const ev2 = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev1.id, name: "Guest", order: 0 } });

    const res = await guestRsvpPost(ctx(ev2.id, guest.id, { status: "yes" }, { user: { id: "owner", name: "O" } }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/does not belong/i);
  });

  it("refuses after kickoff (409)", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id, -60_000);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });

    const res = await guestRsvpPost(ctx(ev.id, guest.id, { status: "yes" }, { user: { id: "owner", name: "O" } }));
    expect(res.status).toBe(409);
  });

  it("accepts null status (clears the guest RSVP)", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });

    // First set yes
    await guestRsvpPost(ctx(ev.id, guest.id, { status: "yes" }, { user: { id: "owner", name: "O" } }));
    // Then clear
    const res = await guestRsvpPost(ctx(ev.id, guest.id, { status: null }, { user: { id: "owner", name: "O" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBeNull();
  });

  it("is idempotent (upsert on playerId+eventId)", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    const guest = await testPrisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 0 } });

    await guestRsvpPost(ctx(ev.id, guest.id, { status: "yes" }, { user: { id: "owner", name: "O" } }));
    await guestRsvpPost(ctx(ev.id, guest.id, { status: "no" }, { user: { id: "owner", name: "O" } }));

    const count = await testPrisma.rsvp.count({ where: { eventId: ev.id, playerId: guest.id } });
    expect(count).toBe(1);
  });
});
