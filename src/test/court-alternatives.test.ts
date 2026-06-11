import { describe, it, expect, vi, afterEach } from "vitest";
import { parseCourtWatchConfig } from "~/lib/courtAlternatives.server";

// Define mock fns at module level
const mockSearchClubs = vi.fn();
const mockGetAvailability = vi.fn();
const mockGetClubResources = vi.fn();

vi.mock("~/lib/playtomic.server", () => ({
  searchClubs: (...args: unknown[]) => mockSearchClubs(...args),
  getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
  getClubResources: (...args: unknown[]) => mockGetClubResources(...args),
  mapSportToPlaytomic: (s: string) => {
    const map: Record<string, string> = { padel: "PADEL", "football-5v5": "FUTSAL" };
    return map[s] ?? null;
  },
  isPlaytomicSport: (s: string) => ["padel", "football-5v5", "tennis-singles", "football-7v7", "tennis-doubles", "futsal"].includes(s),
}));

vi.mock("~/lib/playtomic", () => ({
  isPlaytomicSport: (s: string) => ["padel", "football-5v5", "tennis-singles", "football-7v7", "tennis-doubles", "futsal"].includes(s),
  mapSportToPlaytomic: (s: string) => {
    const map: Record<string, string> = { padel: "PADEL", "football-5v5": "FUTSAL" };
    return map[s] ?? null;
  },
}));

// Import after mocks
const { searchCourtAlternatives } = await import("~/lib/courtAlternatives.server");

afterEach(() => {
  mockSearchClubs.mockReset();
  mockGetAvailability.mockReset();
  mockGetClubResources.mockReset();
});

// ── parseCourtWatchConfig ──────────────────────────────────────────────────────

describe("parseCourtWatchConfig", () => {
  it("returns null for null input", () => {
    expect(parseCourtWatchConfig(null)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseCourtWatchConfig("not json")).toBeNull();
  });

  it("returns null when radius is missing", () => {
    expect(parseCourtWatchConfig(JSON.stringify({ indoor: true }))).toBeNull();
  });

  it("parses valid config", () => {
    const config = parseCourtWatchConfig(JSON.stringify({ radius: 5000, indoor: true, surface: "clay" }));
    expect(config).toEqual({ radius: 5000, indoor: true, surface: "clay" });
  });

  it("defaults indoor and surface to null", () => {
    const config = parseCourtWatchConfig(JSON.stringify({ radius: 10000 }));
    expect(config).toEqual({ radius: 10000, indoor: null, surface: null });
  });
});

// ── searchCourtAlternatives ────────────────────────────────────────────────────

describe("searchCourtAlternatives", () => {
  const baseParams = {
    sport: "padel",
    dateTime: new Date("2026-06-10T20:00:00Z"),
    durationMinutes: 60,
    latitude: 38.7,
    longitude: -9.1,
    config: { radius: 10000, indoor: null, surface: null },
  };

  it("returns error for unsupported sport", async () => {
    const result = await searchCourtAlternatives({ ...baseParams, sport: "basketball" });
    expect(result.error).toBe("Sport not supported by Playtomic");
    expect(result.alternatives).toEqual([]);
  });

  it("returns empty when no clubs found", async () => {
    mockSearchClubs.mockResolvedValue({ clubs: [] });
    const result = await searchCourtAlternatives(baseParams);
    expect(result.alternatives).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("returns error from searchClubs", async () => {
    mockSearchClubs.mockResolvedValue({ clubs: [], error: "API down" });
    const result = await searchCourtAlternatives(baseParams);
    expect(result.error).toBe("API down");
  });

  it("filters slots by time tolerance (±30 min)", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: [{
        tenant_id: "club1", tenant_name: "Club One",
        address: { street: "Rua A", city: "Lisboa", postal_code: "1000", country: "PT" },
        coordinate: { lat: 38.7, lon: -9.1 }, images: [],
      }],
    });

    mockGetAvailability.mockResolvedValue({
      courts: [{
        resource_id: "court1", resource_name: "Court 1",
        slots: [
          { start_time: "20:00:00", duration: 60, price: 20, currency: "EUR" }, // exact match
          { start_time: "20:30:00", duration: 60, price: 25, currency: "EUR" }, // +30min — boundary
          { start_time: "19:30:00", duration: 60, price: 15, currency: "EUR" }, // -30min — boundary
          { start_time: "18:00:00", duration: 60, price: 10, currency: "EUR" }, // too early
          { start_time: "21:31:00", duration: 60, price: 30, currency: "EUR" }, // too late
        ],
      }],
    });

    const result = await searchCourtAlternatives(baseParams);
    expect(result.alternatives).toHaveLength(3);
    const times = result.alternatives.map((a) => a.slotTime);
    expect(times).toContain("19:30");
    expect(times).toContain("20:00");
    expect(times).toContain("20:30");
  });

  it("filters slots by minimum duration", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "club1", tenant_name: "Club", address: null, coordinate: null, images: [] }],
    });

    mockGetAvailability.mockResolvedValue({
      courts: [{
        resource_id: "c1", resource_name: "Court",
        slots: [
          { start_time: "20:00:00", duration: 60, price: 20, currency: "EUR" }, // meets min
          { start_time: "20:00:00", duration: 30, price: 10, currency: "EUR" }, // too short
          { start_time: "20:00:00", duration: 90, price: 30, currency: "EUR" }, // exceeds — ok
        ],
      }],
    });

    const result = await searchCourtAlternatives(baseParams);
    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives.map((a) => a.duration).sort()).toEqual([60, 90]);
  });

  it("sorts results by price ascending", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "c1", tenant_name: "C", address: null, coordinate: null, images: [] }],
    });

    mockGetAvailability.mockResolvedValue({
      courts: [{
        resource_id: "r1", resource_name: "R",
        slots: [
          { start_time: "20:00:00", duration: 60, price: 30, currency: "EUR" },
          { start_time: "20:10:00", duration: 60, price: 10, currency: "EUR" },
          { start_time: "20:15:00", duration: 60, price: 20, currency: "EUR" },
        ],
      }],
    });

    const result = await searchCourtAlternatives(baseParams);
    expect(result.alternatives.map((a) => a.price)).toEqual([10, 20, 30]);
  });

  it("respects maxClubs limit", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: Array.from({ length: 10 }, (_, i) => ({
        tenant_id: `club${i}`, tenant_name: `Club ${i}`,
        address: null, coordinate: null, images: [],
      })),
    });

    mockGetAvailability.mockResolvedValue({ courts: [] });

    await searchCourtAlternatives({ ...baseParams, maxClubs: 3 });
    expect(mockGetAvailability).toHaveBeenCalledTimes(3);
  });

  it("continues when one club returns an error", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: [
        { tenant_id: "club1", tenant_name: "Club 1", address: null, coordinate: null, images: [] },
        { tenant_id: "club2", tenant_name: "Club 2", address: null, coordinate: null, images: [] },
      ],
    });

    mockGetAvailability
      .mockResolvedValueOnce({ courts: [], error: "timeout" })
      .mockResolvedValueOnce({
        courts: [{ resource_id: "r1", resource_name: "R", slots: [{ start_time: "20:00:00", duration: 60, price: 15, currency: "EUR" }] }],
      });

    const result = await searchCourtAlternatives(baseParams);
    expect(result.alternatives).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  it("does not call getClubResources unless includeBooked is set", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "club1", tenant_name: "Club 1", address: null, coordinate: null, images: [] }],
    });
    mockGetAvailability.mockResolvedValue({ courts: [] });

    await searchCourtAlternatives(baseParams);
    expect(mockGetClubResources).not.toHaveBeenCalled();
  });

  it("includes booked courts (no slot in window) when includeBooked is true", async () => {
    mockSearchClubs.mockResolvedValue({
      clubs: [{ tenant_id: "club1", tenant_name: "Club 1", address: null, coordinate: null, images: [] }],
    });
    // court1 is available at 20:00; court2 has no slot → booked
    mockGetAvailability.mockResolvedValue({
      courts: [{ resource_id: "court1", resource_name: "Court 1", slots: [{ start_time: "20:00:00", duration: 60, price: 15, currency: "EUR" }] }],
    });
    mockGetClubResources.mockResolvedValue({
      resources: [
        { resource_id: "court1", name: "Court 1", sport_id: "PADEL", indoor: true },
        { resource_id: "court2", name: "Court 2", sport_id: "PADEL", indoor: false },
      ],
    });

    const result = await searchCourtAlternatives({ ...baseParams, includeBooked: true });
    const available = result.alternatives.filter((a) => a.status === "available");
    const booked = result.alternatives.filter((a) => a.status === "booked");
    expect(available).toHaveLength(1);
    expect(available[0].resourceId).toBe("court1");
    expect(booked).toHaveLength(1);
    expect(booked[0].resourceId).toBe("court2");
    expect(booked[0].price).toBeNull();
  });
});
