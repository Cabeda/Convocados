import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mapSportToPlaytomic,
  isPlaytomicSport,
} from "~/lib/playtomic";
import {
  searchClubs,
  getAvailability,
  buildPlaytomicUrl,
} from "~/lib/playtomic.server";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Sport mapping ─────────────────────────────────────────────────────────────

describe("mapSportToPlaytomic", () => {
  it("maps padel to PADEL", () => {
    expect(mapSportToPlaytomic("padel")).toBe("PADEL");
  });

  it("maps tennis-singles to TENNIS", () => {
    expect(mapSportToPlaytomic("tennis-singles")).toBe("TENNIS");
  });

  it("maps tennis-doubles to TENNIS", () => {
    expect(mapSportToPlaytomic("tennis-doubles")).toBe("TENNIS");
  });

  it("maps football-5v5 to FUTSAL", () => {
    expect(mapSportToPlaytomic("football-5v5")).toBe("FUTSAL");
  });

  it("maps football-7v7 to FOOTBALL7", () => {
    expect(mapSportToPlaytomic("football-7v7")).toBe("FOOTBALL7");
  });

  it("returns null for football-11v11 (not on Playtomic)", () => {
    expect(mapSportToPlaytomic("football-11v11")).toBeNull();
  });

  it("maps futsal to FUTSAL", () => {
    expect(mapSportToPlaytomic("futsal")).toBe("FUTSAL");
  });

  it("returns null for basketball", () => {
    expect(mapSportToPlaytomic("basketball")).toBeNull();
  });

  it("returns null for volleyball", () => {
    expect(mapSportToPlaytomic("volleyball")).toBeNull();
  });

  it("returns null for other", () => {
    expect(mapSportToPlaytomic("other")).toBeNull();
  });

  it("returns null for unknown sport", () => {
    expect(mapSportToPlaytomic("cricket")).toBeNull();
  });
});

describe("isPlaytomicSport", () => {
  it("returns true for padel", () => {
    expect(isPlaytomicSport("padel")).toBe(true);
  });

  it("returns true for football-5v5", () => {
    expect(isPlaytomicSport("football-5v5")).toBe(true);
  });

  it("returns false for basketball", () => {
    expect(isPlaytomicSport("basketball")).toBe(false);
  });

  it("returns false for other", () => {
    expect(isPlaytomicSport("other")).toBe(false);
  });
});

// ── searchClubs ───────────────────────────────────────────────────────────────

describe("searchClubs", () => {
  it("returns error for unsupported sport", async () => {
    const result = await searchClubs({ lat: 41.15, lng: -8.63, sport: "basketball" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toBe("Unsupported sport for Playtomic search");
  });

  it("returns clubs on successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            tenant_id: "abc123",
            tenant_name: "Padel Club Porto",
            address: {
              street: "Rua do Padel 1",
              city: "Porto",
              postal_code: "4000-001",
              country: "PT",
              coordinate: { lat: 41.15, lon: -8.63 },
            },
            images: [{ image_url: "https://example.com/img.jpg" }],
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await searchClubs({ lat: 41.15, lng: -8.63, sport: "padel" });
    expect(result.error).toBeUndefined();
    expect(result.clubs).toHaveLength(1);
    expect(result.clubs[0].tenant_id).toBe("abc123");
    expect(result.clubs[0].tenant_name).toBe("Padel Club Porto");
    expect(result.clubs[0].address?.city).toBe("Porto");
    expect(result.clubs[0].coordinate).toEqual({ lat: 41.15, lon: -8.63 });
    expect(result.clubs[0].images).toEqual(["https://example.com/img.jpg"]);
  });

  it("passes correct query params to Playtomic API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200 }),
    );

    await searchClubs({ lat: 38.72, lng: -9.14, sport: "tennis-singles", radius: 20000, size: 10 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("coordinate=38.72,-9.14");
    expect(url).toContain("sport_id=TENNIS");
    expect(url).toContain("radius=20000");
    expect(url).toContain("size=10");
    expect(url).toContain("playtomic_status=ACTIVE");
  });

  it("uses default radius and size", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200 }),
    );

    await searchClubs({ lat: 41.15, lng: -8.63, sport: "padel" });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("radius=15000");
    expect(url).toContain("size=20");
  });

  it("returns error on non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Server Error", { status: 500 }),
    );

    const result = await searchClubs({ lat: 41.15, lng: -8.63, sport: "padel" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toBe("Playtomic API returned 500");
  });

  it("returns error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const result = await searchClubs({ lat: 41.15, lng: -8.63, sport: "padel" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toBe("network error");
  });

  it("returns error on unexpected response format", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "bad" }), { status: 200 }),
    );

    const result = await searchClubs({ lat: 41.15, lng: -8.63, sport: "padel" });
    expect(result.clubs).toEqual([]);
    expect(result.error).toBe("Unexpected response format");
  });

  it("handles clubs with missing address gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([{ tenant_id: "x", tenant_name: "No Address Club" }]),
        { status: 200 },
      ),
    );

    const result = await searchClubs({ lat: 41.15, lng: -8.63, sport: "padel" });
    expect(result.clubs).toHaveLength(1);
    expect(result.clubs[0].address).toBeNull();
    expect(result.clubs[0].coordinate).toBeNull();
    expect(result.clubs[0].images).toEqual([]);
  });
});

// ── getAvailability ───────────────────────────────────────────────────────────

describe("getAvailability", () => {
  it("returns error for unsupported sport", async () => {
    const result = await getAvailability({
      tenantId: "abc",
      date: "2026-04-01",
      sport: "volleyball",
    });
    expect(result.courts).toEqual([]);
    expect(result.error).toBe("Unsupported sport for Playtomic search");
  });

  it("returns courts with slots on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            resource_id: "court-1",
            resource_name: "Court 1",
            slots: [
              { start_time: "10:00:00", duration: 90, price: 24.0, currency: "EUR" },
              { start_time: "11:30:00", duration: 90, price: 28.0, currency: "EUR" },
            ],
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await getAvailability({
      tenantId: "abc123",
      date: "2026-04-01",
      sport: "padel",
    });

    expect(result.error).toBeUndefined();
    expect(result.courts).toHaveLength(1);
    expect(result.courts[0].resource_name).toBe("Court 1");
    expect(result.courts[0].slots).toHaveLength(2);
    expect(result.courts[0].slots[0]).toEqual({
      start_time: "10:00:00",
      duration: 90,
      price: 24.0,
      currency: "EUR",
    });
  });

  it("passes correct query params", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200 }),
    );

    await getAvailability({
      tenantId: "abc123",
      date: "2026-04-01",
      sport: "football-5v5",
      duration: 60,
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("tenant_id=abc123");
    expect(url).toContain("sport_id=FUTSAL");
    expect(url).toContain("local_start_min=2026-04-01T00:00:00");
    expect(url).toContain("local_start_max=2026-04-01T23:59:59");
  });

  it("returns error on non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    const result = await getAvailability({
      tenantId: "abc",
      date: "2026-04-01",
      sport: "padel",
    });
    expect(result.courts).toEqual([]);
    expect(result.error).toBe("Playtomic API returned 404");
  });

  it("returns error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));

    const result = await getAvailability({
      tenantId: "abc",
      date: "2026-04-01",
      sport: "padel",
    });
    expect(result.courts).toEqual([]);
    expect(result.error).toBe("timeout");
  });

  it("handles courts with no slots", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([{ resource_id: "c1", resource_name: "Court 1" }]),
        { status: 200 },
      ),
    );

    const result = await getAvailability({
      tenantId: "abc",
      date: "2026-04-01",
      sport: "padel",
    });
    expect(result.courts).toHaveLength(1);
    expect(result.courts[0].slots).toEqual([]);
  });
});

// ── buildPlaytomicUrl ─────────────────────────────────────────────────────────

describe("buildPlaytomicUrl", () => {
  it("builds correct URL", () => {
    expect(buildPlaytomicUrl("abc123")).toBe("https://playtomic.io/tenant/abc123");
  });
});
