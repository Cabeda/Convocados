import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { POST as resetPlayerOrder } from "~/pages/api/events/[id]/reset-player-order";

// Stub auth — default: no session (anonymous)
let mockSession: any = null;
vi.mock("~/lib/auth.helpers.server", () => ({
  checkOwnership: vi.fn(async (_req: Request, ownerId: string | null) => ({
    isOwner: mockSession?.user?.id !== null && mockSession.user.id === ownerId,
  })),
  getSession: vi.fn(async () => mockSession),
}));

function ctx(params: Record<string, string>) {
  return {
    request: new Request("http://localhost/api/test", { method: "POST" }),
    params,
  } as any;
}

async function seedEvent(ownerId?: string) {
  return prisma.event.create({
    data: { title: "Test", location: "Field", dateTime: new Date(), ownerId },
  });
}

beforeEach(async () => {
  mockSession = null;
  await resetApiRateLimitStore();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(id = "owner-1") {
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: { id, name: "Owner", email: `${id}@test.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  });
  return id;
}

describe("POST /api/events/[id]/reset-player-order", () => {
  it("resets player order to signup order (createdAt)", async () => {
    const ownerId = await seedUser();
    const event = await seedEvent(ownerId);
    mockSession = { user: { id: ownerId } };

    // Create players with staggered createdAt, then scramble order
    const _p1 = await prisma.player.create({ data: { name: "First", eventId: event.id, order: 2, createdAt: new Date("2026-01-01T10:00:00Z") } });
    const _p2 = await prisma.player.create({ data: { name: "Second", eventId: event.id, order: 0, createdAt: new Date("2026-01-01T11:00:00Z") } });
    const _p3 = await prisma.player.create({ data: { name: "Third", eventId: event.id, order: 1, createdAt: new Date("2026-01-01T12:00:00Z") } });

    const res = await resetPlayerOrder(ctx({ id: event.id }));
    expect(res.status).toBe(200);

    const players = await prisma.player.findMany({ where: { eventId: event.id }, orderBy: { order: "asc" } });
    expect(players.map((p) => p.name)).toEqual(["First", "Second", "Third"]);
    expect(players.map((p) => p.order)).toEqual([0, 1, 2]);
  });

  it("returns 404 for unknown event", async () => {
    const res = await resetPlayerOrder(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner", async () => {
    const ownerId = await seedUser();
    const event = await seedEvent(ownerId);
    mockSession = { user: { id: "someone-else" } };

    const res = await resetPlayerOrder(ctx({ id: event.id }));
    expect(res.status).toBe(403);
  });

  it("handles event with no players", async () => {
    const ownerId = await seedUser();
    const event = await seedEvent(ownerId);
    mockSession = { user: { id: ownerId } };

    const res = await resetPlayerOrder(ctx({ id: event.id }));
    expect(res.status).toBe(200);
  });
});
