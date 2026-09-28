import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET as locationsGet } from "~/pages/api/me/locations";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({ getSession: vi.fn() }));
vi.mock("~/lib/authenticate.server", () => ({ authenticateRequest: vi.fn() }));

const mockGetSession = vi.mocked(getSession);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx() {
  return { request: new Request("http://localhost/api/me/locations") } as never;
}

function authAs(userId: string) {
  mockAuthenticateRequest.mockResolvedValue(null);
  mockGetSession.mockResolvedValue({ user: { id: userId, name: "Me" } } as never);
}

async function seedUser(id: string) {
  return prisma.user.create({ data: { id, name: id, email: `${id}@test.dev`, emailVerified: true } });
}

async function seedEvent(opts: {
  title: string;
  location: string;
  ownerId: string | null;
  latitude?: number | null;
  longitude?: number | null;
}) {
  return prisma.event.create({
    data: {
      title: opts.title,
      location: opts.location,
      dateTime: new Date(Date.now() + DAY),
      maxPlayers: 10,
      ownerId: opts.ownerId,
      latitude: opts.latitude ?? null,
      longitude: opts.longitude ?? null,
    },
  });
}

describe("GET /api/me/locations", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue(null);
    const res = await locationsGet(ctx());
    expect(res.status).toBe(401);
  });

  it("ranks the viewer's most-used venues first", async () => {
    const me = await seedUser("me");
    const other = await seedUser("other");
    authAs(me.id);
    // Two events at Areosa, one at Padel Club, one the viewer isn't in.
    await seedEvent({ title: "A1", location: "Areosa", ownerId: me.id, latitude: 41.18, longitude: -8.63 });
    const a2 = await seedEvent({ title: "A2", location: "Areosa", ownerId: other.id, latitude: 41.18, longitude: -8.63 });
    const p1 = await seedEvent({ title: "P1", location: "Padel Club", ownerId: other.id, latitude: 41.15, longitude: -8.61 });
    await seedEvent({ title: "X", location: "Nowhere", ownerId: other.id });
    await prisma.eventPlayer.create({ data: { eventId: a2.id, name: "Me", userId: me.id } });
    await prisma.eventPlayer.create({ data: { eventId: p1.id, name: "Me", userId: me.id } });

    const res = await locationsGet(ctx());
    const body = await res.json();
    expect(body.locations.map((l: { location: string }) => l.location)).toEqual(["Areosa", "Padel Club"]);
    expect(body.locations[0]).toMatchObject({ latitude: 41.18, longitude: -8.63, count: 2 });
  });

  it("drops blank locations and dedupes by name", async () => {
    const me = await seedUser("me");
    authAs(me.id);
    await seedEvent({ title: "A", location: "", ownerId: me.id });
    await seedEvent({ title: "B", location: "Areosa", ownerId: me.id });
    await seedEvent({ title: "C", location: "Areosa", ownerId: me.id });

    const res = await locationsGet(ctx());
    const body = await res.json();
    expect(body.locations).toHaveLength(1);
    expect(body.locations[0].location).toBe("Areosa");
    expect(body.locations[0].count).toBe(2);
  });

  it("caps the list at five venues", async () => {
    const me = await seedUser("me");
    authAs(me.id);
    for (let i = 0; i < 7; i++) {
      await seedEvent({ title: `E${i}`, location: `Venue ${i}`, ownerId: me.id });
    }
    const res = await locationsGet(ctx());
    const body = await res.json();
    expect(body.locations).toHaveLength(5);
  });
});
