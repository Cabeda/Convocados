import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { checkOwnership } from "~/lib/auth.helpers.server";
const mockCheckOwnership = vi.mocked(checkOwnership);

import { PUT } from "~/pages/api/events/[id]/manual-rating";

function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

async function seedUser(id: string, name: string) {
  await prisma.user.upsert({
    where: { id },
    create: { id, name, email: `${id}@test.com`, emailVerified: true },
    update: {},
  });
}

async function seedEvent(ownerId?: string) {
  if (ownerId) {
    await seedUser(ownerId, "Owner");
  }
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: ownerId ?? null,
      allowManualRating: false,
    },
  });
}

describe("Manual Rating toggle API", () => {
  beforeEach(async () => {
    await prisma.playerRating.deleteMany();
    await prisma.gameHistory.deleteMany();
    await prisma.eventAdmin.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    await resetApiRateLimitStore();
    mockCheckOwnership.mockResolvedValue({
      isOwner: true,
      isAdmin: false,
      session: { user: { id: "owner1", name: "Owner" } },
    } as any);
  });

  it("enables manual rating", async () => {
    const event = await seedEvent("owner1");

    const res = await PUT(ctx({ id: event.id }, { allowManualRating: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowManualRating).toBe(true);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated!.allowManualRating).toBe(true);
  });

  it("disables manual rating", async () => {
    const event = await seedEvent("owner1");
    await prisma.event.update({ where: { id: event.id }, data: { allowManualRating: true } });

    const res = await PUT(ctx({ id: event.id }, { allowManualRating: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowManualRating).toBe(false);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated!.allowManualRating).toBe(false);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await PUT(ctx({ id: "nonexistent" }, { allowManualRating: true }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner", async () => {
    const event = await seedEvent("owner1");
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await PUT(ctx({ id: event.id }, { allowManualRating: true }));
    expect(res.status).toBe(403);
  });

  it("allows admin to toggle", async () => {
    const event = await seedEvent("owner1");
    mockCheckOwnership.mockResolvedValue({
      isOwner: false,
      isAdmin: true,
      session: { user: { id: "admin1", name: "Admin" } },
    } as any);

    const res = await PUT(ctx({ id: event.id }, { allowManualRating: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowManualRating).toBe(true);
  });

  it("coerces truthy values to boolean", async () => {
    const event = await seedEvent("owner1");

    const res = await PUT(ctx({ id: event.id }, { allowManualRating: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowManualRating).toBe(true);
  });
});
