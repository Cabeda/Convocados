import { describe, it, expect, vi, afterEach } from "vitest";
import { searchClubs, getAvailability, parsePlaytomicPrice, getClubResources } from "~/lib/playtomic.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parsePlaytomicPrice", () => {
  it("parses the live combined string format '72 GBP'", () => {
    expect(parsePlaytomicPrice("72 GBP")).toEqual({ price: 72, currency: "GBP" });
  });

  it("parses decimals and EUR", () => {
    expect(parsePlaytomicPrice("24.5 EUR")).toEqual({ price: 24.5, currency: "EUR" });
  });

  it("parses comma decimals", () => {
    expect(parsePlaytomicPrice("16,50 EUR")).toEqual({ price: 16.5, currency: "EUR" });
  });

  it("keeps numeric price with separate currency (legacy format)", () => {
    expect(parsePlaytomicPrice(20, "EUR")).toEqual({ price: 20, currency: "EUR" });
  });

  it("defaults currency to EUR when only an amount string is present", () => {
    expect(parsePlaytomicPrice("30")).toEqual({ price: 30, currency: "EUR" });
  });

  it("returns null for undefined/null/empty/invalid", () => {
    expect(parsePlaytomicPrice(undefined)).toEqual({ price: null, currency: null });
    expect(parsePlaytomicPrice(null)).toEqual({ price: null, currency: null });
    expect(parsePlaytomicPrice("")).toEqual({ price: null, currency: null });
    expect(parsePlaytomicPrice("free")).toEqual({ price: null, currency: null });
    expect(parsePlaytomicPrice(NaN)).toEqual({ price: null, currency: null });
  });
});

describe("searchClubs", () => {
  it("returns error for unsupported sport", async () => {
    const result = await searchClubs({ lat: 41, lng: -8, sport: "cricket" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toContain("Unsupported sport");
  });

  it("returns error when API returns non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await searchClubs({ lat: 41, lng: -8, sport: "padel" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toContain("503");
    vi.unstubAllGlobals();
  });

  it("returns error when response is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    const result = await searchClubs({ lat: 41, lng: -8, sport: "padel" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toContain("Unexpected response");
    vi.unstubAllGlobals();
  });

  it("handles network errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const result = await searchClubs({ lat: 41, lng: -8, sport: "padel" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toBe("timeout");
    vi.unstubAllGlobals();
  });

  it("handles non-Error throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("string error"));
    const result = await searchClubs({ lat: 41, lng: -8, sport: "padel" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toBe("Unknown error");
    vi.unstubAllGlobals();
  });

  it("maps club data correctly with null address", async () => {
    const mockData = [{ tenant_id: "t1", tenant_name: "Club A", address: null, images: [] }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) }));
    const result = await searchClubs({ lat: 41, lng: -8, sport: "padel" });
    expect(result.clubs).toHaveLength(1);
    expect(result.clubs[0].address).toBeNull();
    expect(result.clubs[0].coordinate).toBeNull();
    vi.unstubAllGlobals();
  });

  it("maps club data with address and coordinate", async () => {
    const mockData = [{
      tenant_id: "t1", tenant_name: "Club B",
      address: { street: "Rua X", city: "Porto", postal_code: "4000", country: "PT", coordinate: { lat: 41.1, lon: -8.6 } },
      images: [{ image_url: "http://img.jpg" }],
    }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) }));
    const result = await searchClubs({ lat: 41, lng: -8, sport: "padel" });
    expect(result.clubs[0].coordinate).toEqual({ lat: 41.1, lon: -8.6 });
    expect(result.clubs[0].images).toEqual(["http://img.jpg"]);
    vi.unstubAllGlobals();
  });
});

describe("getAvailability", () => {
  it("returns error for unsupported sport", async () => {
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "cricket" });
    expect(result.courts).toEqual([]);
    expect(result.error).toContain("Unsupported sport");
  });

  it("returns error when API returns non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "padel" });
    expect(result.courts).toEqual([]);
    expect(result.error).toContain("500");
    vi.unstubAllGlobals();
  });

  it("returns error when response is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "padel" });
    expect(result.courts).toEqual([]);
    expect(result.error).toContain("Unexpected response");
    vi.unstubAllGlobals();
  });

  it("handles network errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network fail")));
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "padel" });
    expect(result.courts).toEqual([]);
    expect(result.error).toBe("network fail");
    vi.unstubAllGlobals();
  });

  it("handles non-Error throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(42));
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "padel" });
    expect(result.courts).toEqual([]);
    expect(result.error).toBe("Unknown error");
    vi.unstubAllGlobals();
  });

  it("filters slots by duration when specified", async () => {
    const mockData = [{
      resource_id: "r1", resource_name: "Court 1",
      slots: [
        { start_time: "09:00:00", duration: 60, price: 10, currency: "EUR" },
        { start_time: "10:00:00", duration: 90, price: 15, currency: "EUR" },
        { start_time: "11:30:00", duration: 90, price: 15, currency: "EUR" },
      ],
    }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) }));
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "padel", duration: 90 });
    expect(result.courts[0].slots).toHaveLength(2);
    expect(result.courts[0].slots[0].start_time).toBe("10:00:00");
    vi.unstubAllGlobals();
  });

  it("returns all slots when no duration filter", async () => {
    const mockData = [{
      resource_id: "r1", resource_name: "Court 1",
      slots: [
        { start_time: "09:00:00", duration: 60, price: 10, currency: "EUR" },
        { start_time: "10:00:00", duration: 90, price: 15, currency: "EUR" },
      ],
    }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) }));
    // No duration passed → all slots returned
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "padel" });
    expect(result.courts[0].slots).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("handles court with no slots array", async () => {
    const mockData = [{ resource_id: "r1", resource_name: "Court 1", slots: null }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) }));
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "padel" });
    expect(result.courts[0].slots).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("getClubResources", () => {
  it("returns error for unsupported sport", async () => {
    const result = await getClubResources("t1", "cricket");
    expect(result.resources).toEqual([]);
    expect(result.error).toContain("Unsupported sport");
  });

  it("returns error when API returns non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await getClubResources("t1");
    expect(result.resources).toEqual([]);
    expect(result.error).toContain("404");
    vi.unstubAllGlobals();
  });

  it("returns error when resources is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    const result = await getClubResources("t1");
    expect(result.resources).toEqual([]);
    expect(result.error).toContain("Unexpected response");
    vi.unstubAllGlobals();
  });

  it("maps resources with indoor/outdoor feature", async () => {
    const mockData = {
      resources: [
        { resource_id: "r1", name: "Court 1", sport_id: "PADEL", properties: { resource_feature: "indoor" } },
        { resource_id: "r2", name: "Court 2", sport_id: "PADEL", properties: { resource_feature: "outdoor" } },
        { resource_id: "r3", name: "Court 3", sport_id: "PADEL" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) }));
    const result = await getClubResources("t1", "padel");
    expect(result.error).toBeUndefined();
    expect(result.resources).toHaveLength(3);
    expect(result.resources[0]).toEqual({ resource_id: "r1", name: "Court 1", sport_id: "PADEL", indoor: true });
    expect(result.resources[1].indoor).toBe(false);
    expect(result.resources[2].indoor).toBeNull();
    vi.unstubAllGlobals();
  });

  it("filters resources by sport when provided", async () => {
    const mockData = {
      resources: [
        { resource_id: "r1", name: "Padel 1", sport_id: "PADEL" },
        { resource_id: "r2", name: "Tennis 1", sport_id: "TENNIS" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) }));
    const result = await getClubResources("t1", "padel");
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].resource_id).toBe("r1");
    vi.unstubAllGlobals();
  });

  it("handles network errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network fail")));
    const result = await getClubResources("t1");
    expect(result.resources).toEqual([]);
    expect(result.error).toBe("network fail");
    vi.unstubAllGlobals();
  });
});
