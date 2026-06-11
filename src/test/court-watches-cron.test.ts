import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";

const mockFindWatchMatches = vi.fn();
vi.mock("~/lib/standaloneCourtWatch.server", () => ({
  findWatchMatches: (...args: unknown[]) => mockFindWatchMatches(...args),
}));

const mockSendPush = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/push.server", () => ({
  sendPushToUser: (...args: unknown[]) => mockSendPush(...args),
}));

const { POST } = await import("~/pages/api/cron/court-watches");

const validWatch = {
  sport: "padel", tenantId: "club1", tenantName: "Club One",
  resourceId: "court2", resourceName: "Court 2",
  dayOfWeek: 1, startTime: "18:00", endTime: "20:00", durationMinutes: 90, timezone: "UTC",
};

beforeEach(async () => {
  await prisma.courtWatchHit.deleteMany();
  await prisma.courtWatch.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

function cronReq() {
  return { request: new Request("http://localhost/api/cron/court-watches", { method: "POST" }) } as any;
}

describe("POST /api/cron/court-watches", () => {
  it("notifies and dedups when a court becomes available", async () => {
    await prisma.user.create({ data: { id: "u1", name: "U", email: "u1@test.com", emailVerified: true } });
    const watch = await prisma.courtWatch.create({ data: { ...validWatch, userId: "u1" } });

    mockFindWatchMatches.mockResolvedValue({
      matches: [{ resourceId: "court2", resourceName: "Court 2", slotDate: "2026-06-15", slotTime: "19:00", duration: 90, price: 24, currency: "EUR" }],
    });

    const res1 = await POST(cronReq());
    const data1 = await res1.json();
    expect(data1.results[0].found).toBe(1);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(await prisma.inAppNotification.count()).toBe(1);
    expect(await prisma.courtWatchHit.count({ where: { watchId: watch.id } })).toBe(1);

    // Second run: same slot → deduped, no new notification
    const res2 = await POST(cronReq());
    const data2 = await res2.json();
    expect(data2.results[0].found).toBe(0);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
  });

  it("notifies with no price label when price is null", async () => {
    await prisma.user.create({ data: { id: "u1", name: "U", email: "u1@test.com", emailVerified: true } });
    await prisma.courtWatch.create({ data: { ...validWatch, userId: "u1", resourceId: null, resourceName: null } });
    mockFindWatchMatches.mockResolvedValue({
      matches: [{ resourceId: "courtX", resourceName: "Court X", slotDate: "2026-06-15", slotTime: "19:00", duration: 90, price: null, currency: null }],
    });
    const res = await POST(cronReq());
    const data = await res.json();
    expect(data.results[0].found).toBe(1);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    const [, , body] = mockSendPush.mock.calls[0];
    expect(body).not.toContain("null");
  });

  it("skips inactive watches", async () => {
    await prisma.user.create({ data: { id: "u1", name: "U", email: "u1@test.com", emailVerified: true } });
    await prisma.courtWatch.create({ data: { ...validWatch, userId: "u1", active: false } });
    mockFindWatchMatches.mockResolvedValue({ matches: [] });
    const res = await POST(cronReq());
    const data = await res.json();
    expect(data.processed).toBe(0);
    expect(mockFindWatchMatches).not.toHaveBeenCalled();
  });

  it("records error from findWatchMatches without throwing", async () => {
    await prisma.user.create({ data: { id: "u1", name: "U", email: "u1@test.com", emailVerified: true } });
    await prisma.courtWatch.create({ data: { ...validWatch, userId: "u1" } });
    mockFindWatchMatches.mockResolvedValue({ matches: [], error: "playtomic down" });
    const res = await POST(cronReq());
    const data = await res.json();
    expect(data.results[0].error).toBe("playtomic down");
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});
