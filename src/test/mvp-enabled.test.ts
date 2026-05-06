import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { PUT } from "~/pages/api/events/[id]/mvp-enabled";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/auth.helpers.server")>("~/lib/auth.helpers.server");
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
    request: new Request(`http://localhost/api/events/${eventId}/mvp-enabled`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/mvp-enabled`),
  } as any;
}

async function seedUser(id = "user-mvp-1") {
  return prisma.user.create({
    data: { id, name: "MVP User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(ownerId: string, id = "evt-mvp-1") {
  return prisma.event.create({
    data: { id, title: "MVP Game", location: "Pitch", dateTime: new Date(), maxPlayers: 10, ownerId },
  });
}

describe("PUT /api/events/[id]/mvp-enabled", () => {
  it("toggles mvpEnabled for the event owner", async () => {
    const user = await seedUser();
    const event = await seedEvent(user.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false });

    const res = await PUT(ctx(event.id, { mvpEnabled: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mvpEnabled).toBe(false);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated!.mvpEnabled).toBe(false);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await PUT(ctx("non-existent", { mvpEnabled: true }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });

    const res = await PUT(ctx(event.id, { mvpEnabled: true }));
    expect(res.status).toBe(403);
  });

  it("allows admin to toggle mvpEnabled", async () => {
    const owner = await seedUser("owner-2");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: true });

    const res = await PUT(ctx(event.id, { mvpEnabled: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mvpEnabled).toBe(false);
  });

  it("allows ownerless event to be modified by anyone", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-no-owner", title: "No Owner", location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false });

    const res = await PUT(ctx(event.id, { mvpEnabled: false }));
    expect(res.status).toBe(200);
  });
});
