import { describe, it, expect, vi, afterEach } from "vitest";

const mockGetAvailability = vi.fn();

vi.mock("~/lib/playtomic.server", () => ({
  getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
}));

const { upcomingDatesForWeekday, findWatchMatches, watchQueries, matchWatchInCourts } = await import("~/lib/standaloneCourtWatch.server");

afterEach(() => {
  mockGetAvailability.mockReset();
});

describe("upcomingDatesForWeekday", () => {
  it("returns dates matching the weekday within lookahead", () => {
    // 2026-06-08 is a Monday
    const from = new Date("2026-06-08T10:00:00Z");
    const mondays = upcomingDatesForWeekday(1, 14, from);
    expect(mondays).toEqual(["2026-06-08", "2026-06-15", "2026-06-22"]);
  });

  it("includes today when it matches", () => {
    const from = new Date("2026-06-10T23:00:00Z"); // Wednesday
    const weds = upcomingDatesForWeekday(3, 7, from);
    expect(weds[0]).toBe("2026-06-10");
  });

  it("returns empty when weekday never occurs in a zero lookahead non-match", () => {
    const from = new Date("2026-06-10T00:00:00Z"); // Wednesday
    expect(upcomingDatesForWeekday(1, 0, from)).toEqual([]);
  });
});

describe("findWatchMatches", () => {
  const baseWatch = {
    sport: "padel",
    tenantId: "club1",
    resourceId: "court1",
    dayOfWeek: 1, // Monday
    startTime: "18:00",
    endTime: "20:00",
    durationMinutes: 90,
    maxPrice: null,
  };

  it("matches a slot for the watched court within the window", async () => {
    mockGetAvailability.mockResolvedValue({
      courts: [
        { resource_id: "court1", resource_name: "Court 1", slots: [
          { start_time: "19:00:00", duration: 90, price: 24, currency: "EUR" },
        ] },
        { resource_id: "court2", resource_name: "Court 2", slots: [
          { start_time: "19:00:00", duration: 90, price: 18, currency: "EUR" },
        ] },
      ],
    });
    const { matches } = await findWatchMatches(baseWatch, { lookaheadDays: 0, from: new Date("2026-06-08T00:00:00Z") });
    expect(matches).toHaveLength(1);
    expect(matches[0].resourceId).toBe("court1");
    expect(matches[0].slotTime).toBe("19:00");
    expect(matches[0].slotDate).toBe("2026-06-08");
  });

  it("excludes slots outside the time window", async () => {
    mockGetAvailability.mockResolvedValue({
      courts: [{ resource_id: "court1", resource_name: "Court 1", slots: [
        { start_time: "21:00:00", duration: 90, price: 24, currency: "EUR" },
      ] }],
    });
    const { matches } = await findWatchMatches(baseWatch, { lookaheadDays: 0, from: new Date("2026-06-08T00:00:00Z") });
    expect(matches).toHaveLength(0);
  });

  it("matches any court when resourceId is null", async () => {
    mockGetAvailability.mockResolvedValue({
      courts: [
        { resource_id: "court1", resource_name: "Court 1", slots: [{ start_time: "18:30:00", duration: 90, price: 24, currency: "EUR" }] },
        { resource_id: "court2", resource_name: "Court 2", slots: [{ start_time: "19:30:00", duration: 90, price: 18, currency: "EUR" }] },
      ],
    });
    const { matches } = await findWatchMatches({ ...baseWatch, resourceId: null }, { lookaheadDays: 0, from: new Date("2026-06-08T00:00:00Z") });
    expect(matches).toHaveLength(2);
  });

  it("respects maxPrice", async () => {
    mockGetAvailability.mockResolvedValue({
      courts: [{ resource_id: "court1", resource_name: "Court 1", slots: [
        { start_time: "19:00:00", duration: 90, price: 30, currency: "EUR" },
      ] }],
    });
    const { matches } = await findWatchMatches({ ...baseWatch, maxPrice: 25 }, { lookaheadDays: 0, from: new Date("2026-06-08T00:00:00Z") });
    expect(matches).toHaveLength(0);
  });

  it("returns the error if availability fails", async () => {
    mockGetAvailability.mockResolvedValue({ courts: [], error: "boom" });
    const { matches, error } = await findWatchMatches(baseWatch, { lookaheadDays: 0, from: new Date("2026-06-08T00:00:00Z") });
    expect(error).toBe("boom");
    expect(matches).toHaveLength(0);
  });
});

describe("watchQueries", () => {
  it("returns one availability key per upcoming weekday date", () => {
    const keys = watchQueries({ sport: "padel", tenantId: "club1", dayOfWeek: 1 }, 14, new Date("2026-06-08T00:00:00Z"));
    expect(keys).toEqual([
      { tenantId: "club1", sport: "padel", date: "2026-06-08" },
      { tenantId: "club1", sport: "padel", date: "2026-06-15" },
      { tenantId: "club1", sport: "padel", date: "2026-06-22" },
    ]);
  });
});

describe("matchWatchInCourts (pure)", () => {
  const watch = {
    sport: "padel", tenantId: "club1", resourceId: "court1",
    dayOfWeek: 1, startTime: "18:00", endTime: "20:00", durationMinutes: 90, maxPrice: null,
  };

  it("matches within window for the watched court", () => {
    const courts = [
      { resource_id: "court1", resource_name: "Court 1", slots: [{ start_time: "19:00:00", duration: 90, price: 24, currency: "EUR" }] },
      { resource_id: "court2", resource_name: "Court 2", slots: [{ start_time: "19:00:00", duration: 90, price: 10, currency: "EUR" }] },
    ];
    const matches = matchWatchInCourts(watch, "2026-06-15", courts);
    expect(matches).toHaveLength(1);
    expect(matches[0].resourceId).toBe("court1");
    expect(matches[0].slotDate).toBe("2026-06-15");
  });

  it("excludes out-of-window and short-duration slots", () => {
    const courts = [{ resource_id: "court1", resource_name: "Court 1", slots: [
      { start_time: "21:00:00", duration: 90, price: 24, currency: "EUR" }, // out of window
      { start_time: "19:00:00", duration: 60, price: 24, currency: "EUR" }, // too short
    ] }];
    expect(matchWatchInCourts(watch, "2026-06-15", courts)).toHaveLength(0);
  });

  it("respects maxPrice", () => {
    const courts = [{ resource_id: "court1", resource_name: "Court 1", slots: [
      { start_time: "19:00:00", duration: 90, price: 30, currency: "EUR" },
    ] }];
    expect(matchWatchInCourts({ ...watch, maxPrice: 25 }, "2026-06-15", courts)).toHaveLength(0);
  });
});
