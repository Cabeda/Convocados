import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const mockSearchClubs = vi.fn();
vi.mock("~/lib/playtomic.server", () => ({
  searchClubs: (...args: unknown[]) => mockSearchClubs(...args),
}));

const mockGetCachedAvailability = vi.fn();
vi.mock("~/lib/availabilityCache.server", () => ({
  getCachedAvailability: (...args: unknown[]) => mockGetCachedAvailability(...args),
  mapWithConcurrency: async <T>(items: T[], _limit: number, fn: (item: T) => Promise<unknown>) => {
    for (const it of items) await fn(it);
  },
}));

const { runPickupSweep, resolveAnchors, upcomingDates } = await import("~/lib/pickupSweep.server");

const ANCHOR = { city: "Porto", lat: 41.15, lng: -8.6, timezone: "Europe/Lisbon" };

beforeEach(async () => {
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  delete process.env.SWEEP_ANCHORS;
  vi.clearAllMocks();
});

// A court free at 10:00 and 12:00 → booked 10:30-11:30 (60min), bounded.
const COURTS = [
  {
    resource_id: "court-1",
    resource_name: "Court 1",
    slots: [
      { start_time: "10:00:00", duration: 60, price: null, currency: null },
      { start_time: "12:00:00", duration: 60, price: null, currency: null },
    ],
  },
];

describe("runPickupSweep", () => {
  it("records a search error and continues (no abort)", async () => {
    mockSearchClubs.mockResolvedValue({ clubs: [], error: "Playtomic API returned 403" });
    const result = await runPickupSweep([ANCHOR], { lookaheadDays: 0 });

    expect(result.clubs).toBe(0);
    expect(result.created).toBe(0);
    expect(result.errors.some((e) => e.includes("403"))).toBe(true);
  });

  it("creates a pickup event for each detected booked slot", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "t1", tenant_name: "Club", address: { street: "S", city: "C" }, coordinate: { lat: 1, lon: 2 } }],
    });
    mockGetCachedAvailability.mockResolvedValue({ courts: COURTS });

    const result = await runPickupSweep([ANCHOR], { lookaheadDays: 0 });

    expect(result.created).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
    const event = await prisma.event.findFirst();
    expect(event!.source).toBe("playtomic");
    expect(event!.title).toContain("Club");
  });

  it("skips a date whose availability fetch fails", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "t1", tenant_name: "Club", address: null, coordinate: null }],
    });
    mockGetCachedAvailability.mockResolvedValue({ courts: [], error: "boom" });

    const result = await runPickupSweep([ANCHOR], { lookaheadDays: 0 });
    expect(result.created).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

describe("resolveAnchors", () => {
  it("returns the default Porto + Lisbon anchors when none configured", () => {
    const anchors = resolveAnchors();
    expect(anchors).toHaveLength(2);
    expect(anchors[0].city).toBe("Porto");
    expect(anchors[1].city).toBe("Lisbon");
  });

  it("parses the configured anchors from env", () => {
    process.env.SWEEP_ANCHORS = JSON.stringify([{ city: "Madrid", lat: 40, lng: -3, timezone: "Europe/Madrid" }]);
    const anchors = resolveAnchors();
    expect(anchors).toEqual([{ city: "Madrid", lat: 40, lng: -3, timezone: "Europe/Madrid" }]);
  });

  it("falls back to defaults on invalid JSON", () => {
    process.env.SWEEP_ANCHORS = "not-json";
    expect(resolveAnchors()).toHaveLength(2);
  });
});

describe("upcomingDates", () => {
  it("returns today plus N lookahead days", () => {
    const dates = upcomingDates(2);
    expect(dates).toHaveLength(3);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});