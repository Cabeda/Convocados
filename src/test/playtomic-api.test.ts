import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { resetApiRateLimitStore, checkApiRateLimit } from "~/lib/apiRateLimit.server";
import { GET as getClubs } from "~/pages/api/playtomic/clubs";
import { GET as getAvailability } from "~/pages/api/playtomic/availability";

// Minimal Astro APIContext factory for GET requests
function ctx(queryString: string) {
  const urlStr = `http://localhost/api/playtomic/test?${queryString}`;
  const request = new Request(urlStr, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return { request, params: {}, url: new URL(urlStr) } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: exhaust the read rate limit (120 req/min)
async function exhaustReadRateLimit() {
  for (let i = 0; i < 120; i++) {
    await checkApiRateLimit("unknown", "read");
  }
}

// ── GET /api/playtomic/clubs ──────────────────────────────────────────────────

describe("GET /api/playtomic/clubs", () => {
  it("returns 429 when rate limited", async () => {
    await exhaustReadRateLimit();
    const res = await getClubs(ctx("lat=41.17&lng=-8.59&sport=padel"));
    expect(res.status).toBe(429);
  });

  it("returns 400 when lat/lng are missing", async () => {
    const res = await getClubs(ctx("sport=padel"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("lat and lng");
  });

  it("returns 400 when lat is out of range", async () => {
    const res = await getClubs(ctx("lat=91&lng=0&sport=padel"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid coordinates");
  });

  it("returns 400 when lng is out of range", async () => {
    const res = await getClubs(ctx("lat=0&lng=181&sport=padel"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid coordinates");
  });

  it("returns 400 when sport is missing", async () => {
    const res = await getClubs(ctx("lat=41.17&lng=-8.59"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("sport is required");
  });

  it("returns 502 for unsupported sport", async () => {
    const res = await getClubs(ctx("lat=41.17&lng=-8.59&sport=basketball"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.clubs).toEqual([]);
    expect(body.error).toContain("Unsupported sport");
  });

  it("returns clubs on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            tenant_id: "abc123",
            tenant_name: "Test Club",
            address: { street: "Rua 1", city: "Porto", postal_code: "4000", country: "PT", coordinate: { lat: 41.17, lon: -8.59 } },
            images: [],
          },
        ]),
        { status: 200 },
      ),
    );

    const res = await getClubs(ctx("lat=41.17&lng=-8.59&sport=padel"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clubs).toHaveLength(1);
    expect(body.clubs[0].tenant_id).toBe("abc123");
  });

  it("returns 502 when Playtomic API fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Server Error", { status: 500 }),
    );

    const res = await getClubs(ctx("lat=41.17&lng=-8.59&sport=padel"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.clubs).toEqual([]);
    expect(body.error).toContain("500");
  });
});

// ── GET /api/playtomic/availability ───────────────────────────────────────────

describe("GET /api/playtomic/availability", () => {
  it("returns 429 when rate limited", async () => {
    await exhaustReadRateLimit();
    const res = await getAvailability(ctx("tenantId=abc&date=2026-04-01&sport=padel"));
    expect(res.status).toBe(429);
  });

  it("returns 400 when tenantId is missing", async () => {
    const res = await getAvailability(ctx("date=2026-04-01&sport=padel"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("tenantId is required");
  });

  it("returns 400 when date is missing", async () => {
    const res = await getAvailability(ctx("tenantId=abc&sport=padel"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("date is required");
  });

  it("returns 400 when date format is invalid", async () => {
    const res = await getAvailability(ctx("tenantId=abc&date=01-04-2026&sport=padel"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("date is required");
  });

  it("returns 400 when sport is missing", async () => {
    const res = await getAvailability(ctx("tenantId=abc&date=2026-04-01"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("sport is required");
  });

  it("returns 502 for unsupported sport", async () => {
    const res = await getAvailability(ctx("tenantId=abc&date=2026-04-01&sport=volleyball"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.courts).toEqual([]);
    expect(body.error).toContain("Unsupported sport");
  });

  it("returns courts on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            resource_id: "court-1",
            resource_name: "Court 1",
            slots: [
              { start_time: "10:00:00", duration: 90, price: 24.0, currency: "EUR" },
            ],
          },
        ]),
        { status: 200 },
      ),
    );

    const res = await getAvailability(ctx("tenantId=abc123&date=2026-04-01&sport=padel"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.courts).toHaveLength(1);
    expect(body.courts[0].resource_name).toBe("Court 1");
  });

  it("returns 502 when Playtomic API fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    const res = await getAvailability(ctx("tenantId=abc&date=2026-04-01&sport=padel"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.courts).toEqual([]);
    expect(body.error).toContain("404");
  });
});
