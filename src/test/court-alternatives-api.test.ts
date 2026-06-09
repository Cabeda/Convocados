import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as AuthHelpersServer from "~/lib/auth.helpers.server";
import { prisma } from "~/lib/db.server";
import { GET, PUT } from "~/pages/api/events/[id]/court-alternatives";
import { POST as switchCourt } from "~/pages/api/events/[id]/switch-court";
import { POST as courtWatchCron } from "~/pages/api/cron/court-watch";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", async () => {
  const actual = await vi.importActual<typeof AuthHelpersServer>("~/lib/auth.helpers.server");
  return { ...actual, checkOwnership: vi.fn() };
});

const mockSearchClubs = vi.fn();
const mockGetAvailability = vi.fn();

vi.mock("~/lib/playtomic.server", () => ({
  searchClubs: (...args: unknown[]) => mockSearchClubs(...args),
  getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
  mapSportToPlaytomic: (s: string) => ({ padel: "PADEL", "football-5v5": "FUTSAL" })[s] ?? null,
  isPlaytomicSport: (s: string) => ["padel", "football-5v5"].includes(s),
}));

vi.mock("~/lib/playtomic", () => ({
  isPlaytomicSport: (s: string) => ["padel", "football-5v5"].includes(s),
  mapSportToPlaytomic: (s: string) => ({ padel: "PADEL", "football-5v5": "FUTSAL" })[s] ?? null,
}));

vi.mock("~/lib/push.server", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  cleanupStalePushTokens: vi.fn(),
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(0),
}));

beforeEach(async () => {
  await prisma.courtWatchAlert.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  mockSearchClubs.mockReset();
  mockGetAvailability.mockReset();
});

// ── Helpers ─────────────────────────────────────────────────────────────────────

function getCtx(eventId: string, query = "") {
  const url = `http://localhost/api/events/${eventId}/court-alternatives${query ? "?" + query : ""}`;
  return { request: new Request(url), params: { id: eventId }, url: new URL(url) } as any;
}

function putCtx(eventId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/court-alternatives`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/court-alternatives`),
  } as any;
}

function switchCtx(eventId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/switch-court`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    params: { id: eventId },
    url: new URL(`http://localhost/api/events/${eventId}/switch-court`),
  } as any;
}

function cronCtx(secret?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return { request: new Request("http://localhost/api/cron/court-watch", { method: "POST", headers }), params: {} } as any;
}

async function seedUser(id = "u1") {
  return prisma.user.create({ data: { id, name: "Test", email: `${id}@t.com`, emailVerified: true } });
}

async function seedEvent(ownerId: string, opts: Partial<{ id: string; sport: string; latitude: number; longitude: number; courtWatchConfig: string }> = {}) {
  return prisma.event.create({
    data: {
      id: opts.id ?? "evt1",
      title: "Test Game",
      location: "Old Court",
      dateTime: new Date("2026-06-15T20:00:00Z"),
      maxPlayers: 10,
      sport: opts.sport ?? "padel",
      durationMinutes: 60,
      ownerId,
      latitude: opts.latitude ?? 38.7,
      longitude: opts.longitude ?? -9.1,
      courtWatchConfig: opts.courtWatchConfig ?? null,
    },
  });
}

// ── GET /api/events/[id]/court-alternatives ─────────────────────────────────────

describe("GET /api/events/[id]/court-alternatives", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await GET(getCtx("nope"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
    const res = await GET(getCtx("evt1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 for unsupported sport", async () => {
    const user = await seedUser();
    await seedEvent(user.id, { sport: "basketball" });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
    const res = await GET(getCtx("evt1"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when event has no coordinates", async () => {
    const user = await seedUser();
    await prisma.event.create({
      data: { id: "evt-no-coords", title: "G", location: "L", dateTime: new Date(), maxPlayers: 10, sport: "padel", durationMinutes: 60, ownerId: user.id },
    });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
    const res = await GET(getCtx("evt-no-coords"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("coordinates");
  });

  it("returns alternatives on success", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "t1", tenant_name: "Club A", address: { street: "R1", city: "Lisboa", postal_code: "1000", country: "PT" }, coordinate: { lat: 38.7, lon: -9.1 }, images: [] }],
    });
    mockGetAvailability.mockResolvedValue({
      courts: [{ resource_id: "r1", resource_name: "Court 1", slots: [{ start_time: "20:00:00", duration: 60, price: 15, currency: "EUR" }] }],
    });

    const res = await GET(getCtx("evt1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alternatives).toHaveLength(1);
    expect(body.alternatives[0].tenantName).toBe("Club A");
    expect(body.alternatives[0].price).toBe(15);
  });

  it("passes query params as filter overrides", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
    mockSearchClubs.mockResolvedValue({ clubs: [] });

    await GET(getCtx("evt1", "radius=5000&indoor=true"));
    expect(mockSearchClubs).toHaveBeenCalledWith(expect.objectContaining({ radius: 5000 }));
  });
});

// ── PUT /api/events/[id]/court-alternatives ─────────────────────────────────────

describe("PUT /api/events/[id]/court-alternatives", () => {
  it("returns 403 for non-owner", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
    const res = await PUT(putCtx("evt1", { enabled: true, radius: 10000 }));
    expect(res.status).toBe(403);
  });

  it("enables court watch", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx("evt1", { enabled: true, radius: 8000, indoor: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.courtWatchConfig).toEqual({ radius: 8000, indoor: true, surface: null });

    const evt = await prisma.event.findUnique({ where: { id: "evt1" } });
    expect(JSON.parse(evt!.courtWatchConfig!)).toEqual({ radius: 8000, indoor: true, surface: null });
  });

  it("disables court watch", async () => {
    const user = await seedUser();
    await seedEvent(user.id, { courtWatchConfig: JSON.stringify({ radius: 10000, indoor: null, surface: null }) });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await PUT(putCtx("evt1", { enabled: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.courtWatchConfig).toBeNull();
  });

  it("returns 400 when no coordinates", async () => {
    const user = await seedUser();
    await prisma.event.create({
      data: { id: "evt-nc", title: "G", location: "L", dateTime: new Date(), maxPlayers: 10, sport: "padel", durationMinutes: 60, ownerId: user.id },
    });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
    const res = await PUT(putCtx("evt-nc", { enabled: true, radius: 10000 }));
    expect(res.status).toBe(400);
  });

  it("returns 429 when max watched games reached", async () => {
    const user = await seedUser();
    // Create 20 watched events
    for (let i = 0; i < 20; i++) {
      await prisma.event.create({
        data: { id: `watched-${i}`, title: `G${i}`, location: "L", dateTime: new Date(), maxPlayers: 10, sport: "padel", durationMinutes: 60, ownerId: user.id, latitude: 38.7, longitude: -9.1, courtWatchConfig: JSON.stringify({ radius: 10000, indoor: null, surface: null }) },
      });
    }
    await seedEvent(user.id, { id: "evt-21" });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
    const res = await PUT(putCtx("evt-21", { enabled: true, radius: 10000 }));
    expect(res.status).toBe(429);
  });
});

// ── POST /api/events/[id]/switch-court ──────────────────────────────────────────

describe("POST /api/events/[id]/switch-court", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await switchCourt(switchCtx("nope", { location: "X" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);
    const res = await switchCourt(switchCtx("evt1", { location: "X" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 without location", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
    const res = await switchCourt(switchCtx("evt1", {}));
    expect(res.status).toBe(400);
  });

  it("updates location and disables court watch", async () => {
    const user = await seedUser();
    await seedEvent(user.id, { courtWatchConfig: JSON.stringify({ radius: 10000, indoor: null, surface: null }) });
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await switchCourt(switchCtx("evt1", { location: "New Court, Lisboa", latitude: 38.72, longitude: -9.15 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.location).toBe("New Court, Lisboa");

    const evt = await prisma.event.findUnique({ where: { id: "evt1" } });
    expect(evt!.location).toBe("New Court, Lisboa");
    expect(evt!.latitude).toBe(38.72);
    expect(evt!.longitude).toBe(-9.15);
    expect(evt!.courtWatchConfig).toBeNull();
  });

  it("updates dateTime when provided", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await switchCourt(switchCtx("evt1", { location: "New", dateTime: "2026-06-15T20:30:00Z" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(new Date(body.dateTime).toISOString()).toBe("2026-06-15T20:30:00.000Z");
  });

  it("keeps original dateTime when not provided", async () => {
    const user = await seedUser();
    await seedEvent(user.id);
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);

    const res = await switchCourt(switchCtx("evt1", { location: "New" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(new Date(body.dateTime).toISOString()).toBe("2026-06-15T20:00:00.000Z");
  });
});

// ── POST /api/cron/court-watch ──────────────────────────────────────────────────

describe("POST /api/cron/court-watch", () => {
  it("processes watched events and creates alerts", async () => {
    const user = await seedUser();
    await seedEvent(user.id, { courtWatchConfig: JSON.stringify({ radius: 10000, indoor: null, surface: null }) });

    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "t1", tenant_name: "Club", address: null, coordinate: { lat: 38.7, lon: -9.1 }, images: [] }],
    });
    mockGetAvailability.mockResolvedValue({
      courts: [{ resource_id: "r1", resource_name: "Court 1", slots: [{ start_time: "20:00:00", duration: 60, price: 12, currency: "EUR" }] }],
    });

    const res = await courtWatchCron(cronCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(1);
    expect(body.results[0].found).toBe(1);

    // Alert should be persisted
    const alerts = await prisma.courtWatchAlert.findMany({ where: { eventId: "evt1" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tenantName).toBe("Club");
    expect(alerts[0].price).toBe(12);
  });

  it("deduplicates alerts (same slot not notified twice)", async () => {
    const user = await seedUser();
    await seedEvent(user.id, { courtWatchConfig: JSON.stringify({ radius: 10000, indoor: null, surface: null }) });

    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "t1", tenant_name: "Club", address: null, coordinate: null, images: [] }],
    });
    mockGetAvailability.mockResolvedValue({
      courts: [{ resource_id: "r1", resource_name: "Court 1", slots: [{ start_time: "20:00:00", duration: 60, price: 12, currency: "EUR" }] }],
    });

    // First sweep
    await courtWatchCron(cronCtx());
    // Second sweep — same slot
    const res = await courtWatchCron(cronCtx());
    const body = await res.json();
    expect(body.results[0].found).toBe(0); // no new alerts

    const alerts = await prisma.courtWatchAlert.findMany({ where: { eventId: "evt1" } });
    expect(alerts).toHaveLength(1); // still only 1
  });

  it("skips events without valid config", async () => {
    const user = await seedUser();
    await prisma.event.create({
      data: { id: "bad", title: "G", location: "L", dateTime: new Date(), maxPlayers: 10, sport: "padel", durationMinutes: 60, ownerId: user.id, courtWatchConfig: "invalid json" },
    });

    const res = await courtWatchCron(cronCtx());
    const body = await res.json();
    expect(body.results[0].error).toContain("invalid config");
  });

  it("skips events without coordinates", async () => {
    const user = await seedUser();
    await prisma.event.create({
      data: { id: "noc", title: "G", location: "L", dateTime: new Date(), maxPlayers: 10, sport: "padel", durationMinutes: 60, ownerId: user.id, courtWatchConfig: JSON.stringify({ radius: 10000, indoor: null, surface: null }) },
    });

    const res = await courtWatchCron(cronCtx());
    const body = await res.json();
    expect(body.results[0].error).toContain("invalid config or missing coordinates");
  });

  it("creates in-app notifications for owner", async () => {
    const user = await seedUser();
    await seedEvent(user.id, { courtWatchConfig: JSON.stringify({ radius: 10000, indoor: null, surface: null }) });

    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "t1", tenant_name: "Club", address: null, coordinate: null, images: [] }],
    });
    mockGetAvailability.mockResolvedValue({
      courts: [{ resource_id: "r1", resource_name: "C1", slots: [{ start_time: "20:00:00", duration: 60, price: 10, currency: "EUR" }] }],
    });

    await courtWatchCron(cronCtx());

    const notifs = await prisma.inAppNotification.findMany({ where: { userId: user.id, type: "court_alternative_found" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].body).toContain("Club");
  });
});
