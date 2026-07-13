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

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: async (_req: Request, ownerId: string | null, existingSession?: any) => {
    const session = existingSession ?? await mockGetSession(_req);
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

import { GET } from "~/pages/api/events/[id]/rsvp/summary";

function ctx(eventId: string) {
  return { params: { id: eventId }, request: new Request(`http://localhost/api/events/${eventId}/rsvp/summary`, { method: "GET" }) } as any;
}

async function seedEvent(ownerId: string | null) {
  const event = await testPrisma.event.create({
    data: { title: "Game", location: "Pitch", dateTime: new Date(Date.now() + 86400_000), ownerId },
  });
  const game = await testPrisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  await testPrisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

beforeEach(async () => {
  await testPrisma.rsvp.deleteMany();
  await testPrisma.eventFollow.deleteMany();
  await testPrisma.eventAdmin.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
  vi.clearAllMocks();
});

describe("GET /api/events/[id]/rsvp/summary", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await GET(ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: "stranger", name: "S" } });
    const res = await GET(ctx(ev.id));
    expect(res.status).toBe(403);
  });

  it("returns 401-style forbidden when unauthenticated", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    mockGetSession.mockResolvedValue(null);
    const res = await GET(ctx(ev.id));
    expect(res.status).toBe(403);
  });

  it("returns summary for owner", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    mockGetSession.mockResolvedValue({ user: { id: "owner", name: "O" } });
    const res = await GET(ctx(ev.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.yes).toBe(0);
    expect(body.no).toBe(0);
    expect(body.pending).toBe(1); // owner only
  });

  it("returns summary for event admin", async () => {
    const owner = await testPrisma.user.create({ data: { id: "owner", name: "O", email: "o@t.com", emailVerified: true } });
    const admin = await testPrisma.user.create({ data: { id: "admin", name: "A", email: "a@t.com", emailVerified: true } });
    const ev = await seedEvent(owner.id);
    await testPrisma.eventAdmin.create({ data: { eventId: ev.id, userId: admin.id } });
    mockGetSession.mockResolvedValue({ user: { id: "admin", name: "A" } });
    const res = await GET(ctx(ev.id));
    expect(res.status).toBe(200);
  });
});
