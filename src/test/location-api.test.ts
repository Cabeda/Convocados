import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as AuthHelpersServer from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";
import { PUT } from "~/pages/api/events/[id]/location";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resolveLocation } from "~/lib/geocode";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof AuthHelpersServer>("~/lib/auth.helpers.server");
  return {
    ...actual,
    checkOwnership: vi.fn(),
  };
});

vi.mock("~/lib/geocode", () => ({
  resolveLocation: vi.fn(),
}));

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
    request: new Request(`http://localhost/api/events/${eventId}/location`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/location`),
  } as any;
}

async function seedUser(id = "user-loc-1") {
  return prisma.user.create({
    data: { id, name: "Loc User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(ownerId: string, id = "evt-loc-1") {
  return prisma.event.create({
    data: { id, title: "Loc Game", location: "Old Place", dateTime: new Date(), maxPlayers: 10, ownerId },
  });
}

describe("PUT /api/events/[id]/location", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await PUT(ctx("non-existent", { location: "New Place" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const owner = await seedUser("owner-1");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const res = await PUT(ctx(event.id, { location: "New Place" }));
    expect(res.status).toBe(403);
  });

  it("updates location and geocodes for owner", async () => {
    const owner = await seedUser("owner-2");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
    vi.mocked(resolveLocation).mockResolvedValue({ latitude: 38.7, longitude: -9.1 });

    const res = await PUT(ctx(event.id, { location: "Lisbon" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location).toBe("Lisbon");
    expect(body.latitude).toBe(38.7);
    expect(body.longitude).toBe(-9.1);
    expect(body.geocoded).toBe(true);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated!.location).toBe("Lisbon");
    expect(updated!.latitude).toBe(38.7);
  });

  it("clears coordinates for empty location", async () => {
    const owner = await seedUser("owner-3");
    const event = await seedEvent(owner.id);
    await prisma.event.update({
      where: { id: event.id },
      data: { latitude: 38.7, longitude: -9.1 },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(ctx(event.id, { location: "" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location).toBe("");
    expect(body.latitude).toBeNull();
    expect(body.longitude).toBeNull();
    expect(body.geocoded).toBe(false);
  });

  it("allows admin to update location", async () => {
    const owner = await seedUser("owner-4");
    const event = await seedEvent(owner.id);

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: true, session: null } as any);
    vi.mocked(resolveLocation).mockResolvedValue(null);

    const res = await PUT(ctx(event.id, { location: "Unknown Place" }));
    expect(res.status).toBe(200);
  });

  it("allows ownerless event to be updated", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-no-owner", title: "No Owner", location: "Old", dateTime: new Date(), maxPlayers: 10 },
    });

    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
    vi.mocked(resolveLocation).mockResolvedValue({ latitude: 40.7, longitude: -74 });

    const res = await PUT(ctx(event.id, { location: "New York" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location).toBe("New York");
  });
});
