import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/me/home";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx() {
  return {
    request: new Request("http://localhost/api/me/home", { method: "GET" }),
    params: {},
    url: new URL("http://localhost/api/me/home"),
  } as any;
}

async function seedUser(id = "user-home-1") {
  return prisma.user.create({
    data: { id, name: "Home User", email: `${id}@test.com`, emailVerified: true },
  });
}

function authAs(userId: string) {
  mockAuthenticateRequest.mockResolvedValue(null);
  mockGetSession.mockResolvedValue({ user: { id: userId, name: "Home User" } } as any);
}

interface SeedOpts {
  title?: string;
  dateTime?: Date;
  isPublic?: boolean;
  ownerId?: string | null;
  status?: string;
  maxPlayers?: number;
  sport?: string;
  latitude?: number;
  longitude?: number;
}

async function seedEvent(opts: SeedOpts = {}) {
  const event = await prisma.event.create({
    data: {
      title: opts.title ?? "Game",
      location: "Pitch",
      dateTime: opts.dateTime ?? new Date(Date.now() + DAY),
      maxPlayers: opts.maxPlayers ?? 10,
      isPublic: opts.isPublic ?? false,
      ownerId: opts.ownerId ?? null,
      ...(opts.sport ? { sport: opts.sport } : {}),
      ...(opts.latitude !== undefined ? { latitude: opts.latitude } : {}),
      ...(opts.longitude !== undefined ? { longitude: opts.longitude } : {}),
    },
  });
  if (opts.status) {
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: event.dateTime, status: opts.status },
    });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  }
  return event;
}

describe("GET /api/me/home", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue(null);
    const res = await GET(ctx());
    expect(res.status).toBe(401);
  });

  it("returns owned upcoming events in upNext", async () => {
    const user = await seedUser();
    authAs(user.id);
    await seedEvent({ title: "My Owned", ownerId: user.id });
    const res = await GET(ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upNext.map((g: { title: string }) => g.title)).toEqual(["My Owned"]);
    expect(Array.isArray(body.actions)).toBe(true);
  });

  it("includes events the user plays (EventPlayer.userId) and admins", async () => {
    const user = await seedUser();
    authAs(user.id);
    const playing = await seedEvent({ title: "Playing" });
    await prisma.eventPlayer.create({ data: { eventId: playing.id, name: "Home User", userId: user.id } });
    const admin = await seedEvent({ title: "Adminning" });
    await prisma.eventAdmin.create({ data: { eventId: admin.id, userId: user.id } });
    const res = await GET(ctx());
    const body = await res.json();
    const titles = body.upNext.map((g: { title: string }) => g.title);
    expect(titles).toContain("Playing");
    expect(titles).toContain("Adminning");
  });

  it("excludes past events and events the user is not involved in", async () => {
    const user = await seedUser();
    authAs(user.id);
    await seedEvent({ title: "Past", ownerId: user.id, dateTime: new Date(Date.now() - DAY) });
    await seedEvent({ title: "Someone Else", ownerId: null });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.upNext).toEqual([]);
  });

  it("pins in_progress games first, then orders by kickoff ascending", async () => {
    const user = await seedUser();
    authAs(user.id);
    await seedEvent({ title: "Later", ownerId: user.id, dateTime: new Date(Date.now() + 3 * DAY) });
    await seedEvent({ title: "Sooner", ownerId: user.id, dateTime: new Date(Date.now() + DAY) });
    await seedEvent({
      title: "Live",
      ownerId: user.id,
      dateTime: new Date(Date.now() - HOUR),
      status: "in_progress",
    });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.upNext.map((g: { title: string }) => g.title)).toEqual(["Live", "Sooner", "Later"]);
    expect(body.upNext[0].status).toBe("in_progress");
  });

  it("caps upNext at 3", async () => {
    const user = await seedUser();
    authAs(user.id);
    for (let i = 0; i < 5; i++) {
      await seedEvent({ title: `Game ${i}`, ownerId: user.id, dateTime: new Date(Date.now() + (i + 1) * DAY) });
    }
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.upNext).toHaveLength(3);
  });

  it("returns soonest upcoming public events in discover, excluding involved ones", async () => {
    const user = await seedUser();
    authAs(user.id);
    await seedEvent({ title: "Mine", ownerId: user.id, isPublic: true, dateTime: new Date(Date.now() + DAY) });
    await seedEvent({ title: "Public Later", isPublic: true, dateTime: new Date(Date.now() + 4 * DAY) });
    await seedEvent({ title: "Public Sooner", isPublic: true, dateTime: new Date(Date.now() + 2 * DAY) });
    await seedEvent({ title: "Private", isPublic: false, dateTime: new Date(Date.now() + DAY) });
    await seedEvent({ title: "Public Past", isPublic: true, dateTime: new Date(Date.now() - DAY) });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.discover.map((g: { title: string }) => g.title)).toEqual(["Public Sooner", "Public Later"]);
  });

  it("caps discover at 3", async () => {
    const user = await seedUser();
    authAs(user.id);
    for (let i = 0; i < 5; i++) {
      await seedEvent({ title: `Public ${i}`, isPublic: true, dateTime: new Date(Date.now() + (i + 1) * DAY) });
    }
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.discover).toHaveLength(3);
  });

  it("ranks discover by distance to the user's inferred region", async () => {
    const user = await seedUser();
    authAs(user.id);
    // The user's own game is in Porto → the inferred origin is Porto.
    await seedEvent({ title: "Mine", ownerId: user.id, latitude: 41.15, longitude: -8.61 });
    // Far but sooner (Lisbon); near but later (Porto).
    await seedEvent({ title: "Far Sooner", isPublic: true, dateTime: new Date(Date.now() + DAY), latitude: 38.72, longitude: -9.14 });
    await seedEvent({ title: "Near Later", isPublic: true, dateTime: new Date(Date.now() + 3 * DAY), latitude: 41.16, longitude: -8.62 });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.discover.map((g: { title: string }) => g.title)).toEqual(["Near Later", "Far Sooner"]);
  });

  it("prefers the sports the user plays (distance bonus)", async () => {
    const user = await seedUser();
    authAs(user.id);
    await seedEvent({ title: "My Padel", ownerId: user.id, sport: "padel", latitude: 41.15, longitude: -8.61 });
    // ~0 km, but not a sport the user plays.
    await seedEvent({ title: "Football Near", isPublic: true, sport: "football-5v5", latitude: 41.15, longitude: -8.61 });
    // ~2.8 km, but the user's sport → ranks first via the match bonus.
    await seedEvent({ title: "Padel Farther", isPublic: true, sport: "padel", latitude: 41.17, longitude: -8.63 });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.discover.map((g: { title: string }) => g.title)).toEqual(["Padel Farther", "Football Near"]);
  });

  it("falls back to soonest-first when the user has no located games", async () => {
    const user = await seedUser();
    authAs(user.id);
    await seedEvent({ title: "Mine", ownerId: user.id });
    await seedEvent({ title: "Sooner", isPublic: true, dateTime: new Date(Date.now() + DAY) });
    await seedEvent({ title: "Later", isPublic: true, dateTime: new Date(Date.now() + 4 * DAY) });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.discover.map((g: { title: string }) => g.title)).toEqual(["Sooner", "Later"]);
  });

  it("suggests adding games when the viewer plays in an event they don't own", async () => {
    const user = await seedUser();
    authAs(user.id);
    const other = await seedUser("other-user");
    const event = await seedEvent({ title: "Someone Else's", ownerId: other.id });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Home User", userId: user.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.suggestAddGames).toBe(true);
  });

  it("does not suggest adding games when the viewer only owns games", async () => {
    const user = await seedUser();
    authAs(user.id);
    await seedEvent({ title: "Mine", ownerId: user.id });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.suggestAddGames).toBe(false);
  });

  it("suggests adding games when the viewer owns no active events", async () => {
    const user = await seedUser();
    authAs(user.id);
    await seedEvent({ title: "Someone Else's", ownerId: null });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.suggestAddGames).toBe(true);
  });

  it("suggests adding games for a followed-only event when the viewer owns nothing", async () => {
    const user = await seedUser();
    authAs(user.id);
    const other = await seedUser("other-user");
    const event = await seedEvent({ title: "Followed", ownerId: other.id });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: event.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.suggestAddGames).toBe(true);
  });
});
