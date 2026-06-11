import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";

// Control the matching + fetching collaborators so we can assert the cron's
// batching, dedup, bulk-write and lastCheckedAt behavior precisely.
const mockWatchQueries = vi.fn();
const mockMatchWatchInCourts = vi.fn();
vi.mock("~/lib/standaloneCourtWatch.server", () => ({
  watchQueries: (...args: unknown[]) => mockWatchQueries(...args),
  matchWatchInCourts: (...args: unknown[]) => mockMatchWatchInCourts(...args),
}));

const mockFetchGrouped = vi.fn();
vi.mock("~/lib/availabilityCache.server", () => ({
  fetchAvailabilityGrouped: (...args: unknown[]) => mockFetchGrouped(...args),
  availabilityKeyStr: (k: { tenantId: string; sport: string; date: string }) => `${k.tenantId}|${k.sport}|${k.date}`,
  purgeStaleAvailabilityCache: vi.fn().mockResolvedValue(0),
}));

const mockSendPush = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/push.server", () => ({ sendPushToUser: (...args: unknown[]) => mockSendPush(...args) }));

const { POST } = await import("~/pages/api/cron/court-watches");

const watchRow = {
  sport: "padel", tenantId: "club1", tenantName: "Club One",
  resourceId: "court2", resourceName: "Court 2",
  dayOfWeek: 1, startTime: "18:00", endTime: "20:00", durationMinutes: 90, timezone: "UTC",
};
const KEY = { tenantId: "club1", sport: "padel", date: "2026-06-15" };
const MATCH = { resourceId: "court2", resourceName: "Court 2", slotDate: "2026-06-15", slotTime: "19:00", duration: 90, price: 24, currency: "EUR" };

beforeEach(async () => {
  await prisma.courtWatchHit.deleteMany();
  await prisma.courtWatch.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
  mockWatchQueries.mockReturnValue([KEY]);
  mockFetchGrouped.mockResolvedValue(new Map([["club1|padel|2026-06-15", [{ resource_id: "court2", resource_name: "Court 2", slots: [] }]]]));
});

function cronReq() {
  return { request: new Request("http://localhost/api/cron/court-watches", { method: "POST" }) } as any;
}

describe("POST /api/cron/court-watches", () => {
  it("notifies, bulk-writes a hit, and sets lastCheckedAt; dedups on a second run", async () => {
    await prisma.user.create({ data: { id: "u1", name: "U", email: "u1@test.com", emailVerified: true } });
    const watch = await prisma.courtWatch.create({ data: { ...watchRow, userId: "u1" } });
    mockMatchWatchInCourts.mockReturnValue([MATCH]);

    const res1 = await POST(cronReq());
    const data1 = await res1.json();
    expect(data1.found).toBe(1);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(await prisma.courtWatchHit.count({ where: { watchId: watch.id } })).toBe(1);
    expect(await prisma.inAppNotification.count()).toBe(1);
    const refreshed = await prisma.courtWatch.findUnique({ where: { id: watch.id } });
    expect(refreshed?.lastCheckedAt).not.toBeNull();

    // Second run: same match → deduped
    const res2 = await POST(cronReq());
    const data2 = await res2.json();
    expect(data2.found).toBe(0);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
  });

  it("fetches each unique availability query only once across watches (grouping)", async () => {
    await prisma.user.create({ data: { id: "u1", name: "U", email: "u1@test.com", emailVerified: true } });
    // Two watches on the same club/day → same key
    await prisma.courtWatch.create({ data: { ...watchRow, userId: "u1" } });
    await prisma.courtWatch.create({ data: { ...watchRow, userId: "u1", resourceId: "court3", resourceName: "Court 3" } });
    mockMatchWatchInCourts.mockReturnValue([]);

    await POST(cronReq());
    // fetchAvailabilityGrouped is called once with the combined key list; dedup happens inside it
    expect(mockFetchGrouped).toHaveBeenCalledTimes(1);
    const keysArg = mockFetchGrouped.mock.calls[0][0];
    expect(keysArg).toHaveLength(2); // two watches × one key each (dedup is fetchAvailabilityGrouped's job)
  });

  it("omits the price label when price is null", async () => {
    await prisma.user.create({ data: { id: "u1", name: "U", email: "u1@test.com", emailVerified: true } });
    await prisma.courtWatch.create({ data: { ...watchRow, userId: "u1" } });
    mockMatchWatchInCourts.mockReturnValue([{ ...MATCH, price: null, currency: null }]);

    await POST(cronReq());
    const [, , body] = mockSendPush.mock.calls[0];
    expect(body).not.toContain("null");
  });

  it("processes nothing when there are no active watches", async () => {
    const res = await POST(cronReq());
    const data = await res.json();
    expect(data.processed).toBe(0);
    expect(mockFetchGrouped).not.toHaveBeenCalled();
  });
});
