import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as AuthHelpersServer from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";
import { PUT } from "~/pages/api/events/[id]/positions-enabled";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof AuthHelpersServer>("~/lib/auth.helpers.server");
  return {
    ...actual,
    checkOwnership: vi.fn(),
  };
});

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(eventId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/positions-enabled`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/positions-enabled`),
  } as any;
}

async function seedUser(id = "user-positions-1") {
  return prisma.user.create({
    data: { id, name: "Positions User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(ownerId: string, id = "evt-positions-1") {
  return prisma.event.create({
    data: { id, title: "Positions Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId },
  });
}

describe("PUT /api/events/[id]/positions-enabled", () => {
  it("is off for a new event", async () => {
    const user = await seedUser();
    const event = await seedEvent(user.id);
    expect(event.positionsEnabled).toBe(false);
  });

  it("toggles positionsEnabled for the event owner", async () => {
    const user = await seedUser();
    const event = await seedEvent(user.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(ctx(event.id, { positionsEnabled: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).positionsEnabled).toBe(true);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated!.positionsEnabled).toBe(true);
  });

  it("returns 404 for a non-existent event", async () => {
    const res = await PUT(ctx("non-existent", { positionsEnabled: true }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-owner non-admin", async () => {
    const owner = await seedUser("owner-positions-1");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await PUT(ctx(event.id, { positionsEnabled: true }));
    expect(res.status).toBe(403);
  });
});
