import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockAuthenticate = vi.fn();
vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticate(...args),
}));

vi.mock("~/lib/playtomic", () => ({
  isPlaytomicSport: (s: string) => ["padel", "football-5v5"].includes(s),
  mapSportToPlaytomic: (s: string) => ({ padel: "PADEL", "football-5v5": "FUTSAL" })[s] ?? null,
}));

const { GET, POST } = await import("~/pages/api/court-watches/index");
const { DELETE } = await import("~/pages/api/court-watches/[id]");

beforeEach(async () => {
  await prisma.courtWatchHit.deleteMany();
  await prisma.courtWatch.deleteMany();
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

async function makeUser(id = "u1") {
  return prisma.user.create({ data: { id, name: "U", email: `${id}@test.com`, emailVerified: true } });
}

function req(body?: unknown, method = "POST") {
  return {
    request: new Request("http://localhost/api/court-watches", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  } as any;
}

const validBody = {
  sport: "padel",
  tenantId: "club1",
  tenantName: "Club One",
  resourceId: "court2",
  resourceName: "Court 2",
  dayOfWeek: 1,
  startTime: "18:00",
  endTime: "20:00",
  durationMinutes: 90,
  timezone: "Europe/London",
};

describe("POST /api/court-watches", () => {
  it("401 when not authenticated", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("creates a watch", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const res = await POST(req(validBody));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.watch.tenantName).toBe("Club One");
    expect(data.watch.resourceId).toBe("court2");
    expect(data.watch.dayOfWeek).toBe(1);
  });

  it("applies defaults for optional fields (minimal body)", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({
      sport: "padel", tenantId: "club1", tenantName: "Club One",
      dayOfWeek: 3, startTime: "09:00", endTime: "11:00",
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.watch.resourceId).toBeNull();
    expect(data.watch.resourceName).toBeNull();
    expect(data.watch.durationMinutes).toBe(90);
    expect(data.watch.timezone).toBe("UTC");
    expect(data.watch.maxPrice).toBeNull();
  });

  it("stores maxPrice and custom duration when provided", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ ...validBody, durationMinutes: 60, maxPrice: 20 }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.watch.durationMinutes).toBe(60);
    expect(data.watch.maxPrice).toBe(20);
  });

  it("rejects invalid JSON body", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const ctx = { request: new Request("http://localhost/api/court-watches", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" }) } as any;
    const res = await POST(ctx);
    expect(res.status).toBe(400);
  });

  it("returns 429 when the active watch limit is reached", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    await prisma.courtWatch.createMany({
      data: Array.from({ length: 20 }, () => ({ ...validBody, userId: "u1" })),
    });
    const res = await POST(req(validBody));
    expect(res.status).toBe(429);
  });

  it("rejects invalid sport", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ ...validBody, sport: "chess" }));
    expect(res.status).toBe(400);
  });

  it("rejects bad dayOfWeek", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ ...validBody, dayOfWeek: 9 }));
    expect(res.status).toBe(400);
  });

  it("rejects bad time format", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ ...validBody, startTime: "25:99" }));
    expect(res.status).toBe(400);
  });

  it("rejects start after end", async () => {
    await makeUser();
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ ...validBody, startTime: "21:00", endTime: "20:00" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/court-watches", () => {
  it("lists only the user's watches", async () => {
    await makeUser("u1");
    await makeUser("u2");
    await prisma.courtWatch.create({ data: { ...validBody, userId: "u1" } });
    await prisma.courtWatch.create({ data: { ...validBody, userId: "u2", tenantName: "Other" } });
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const res = await GET(req(undefined, "GET"));
    const data = await res.json();
    expect(data.watches).toHaveLength(1);
    expect(data.watches[0].userId).toBe("u1");
  });
});

describe("DELETE /api/court-watches/[id]", () => {
  it("deletes own watch", async () => {
    await makeUser("u1");
    const w = await prisma.courtWatch.create({ data: { ...validBody, userId: "u1" } });
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const ctx = { request: new Request("http://localhost", { method: "DELETE" }), params: { id: w.id } } as any;
    const res = await DELETE(ctx);
    expect(res.status).toBe(200);
    expect(await prisma.courtWatch.count()).toBe(0);
  });

  it("403 when deleting another user's watch", async () => {
    await makeUser("u1");
    await makeUser("u2");
    const w = await prisma.courtWatch.create({ data: { ...validBody, userId: "u2" } });
    mockAuthenticate.mockResolvedValue({ userId: "u1" });
    const ctx = { request: new Request("http://localhost", { method: "DELETE" }), params: { id: w.id } } as any;
    const res = await DELETE(ctx);
    expect(res.status).toBe(403);
  });
});
