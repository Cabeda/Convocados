import { describe, it, expect, vi, afterEach } from "vitest";
import { searchClubs, getAvailability } from "~/lib/playtomic.server";

afterEach(() => {
  vi.restoreAllMocks();
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
    // Default duration is 90, so it will filter
    const result = await getAvailability({ tenantId: "t1", date: "2024-01-01", sport: "padel" });
    expect(result.courts[0].slots).toHaveLength(1); // only 90min slot
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
