import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";

const mockGetAvailability = vi.fn();
vi.mock("~/lib/playtomic.server", () => ({
  getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
}));

const { getCachedAvailability, fetchAvailabilityGrouped, mapWithConcurrency, availabilityKeyStr, purgeStaleAvailabilityCache } =
  await import("~/lib/availabilityCache.server");

beforeEach(async () => {
  await prisma.playtomicAvailabilityCache.deleteMany();
  vi.clearAllMocks();
});

const courts = [{ resource_id: "r1", resource_name: "Court 1", slots: [{ start_time: "19:00:00", duration: 90, price: 24, currency: "EUR" }] }];

describe("getCachedAvailability", () => {
  it("fetches and stores on a cache miss", async () => {
    mockGetAvailability.mockResolvedValue({ courts });
    const res = await getCachedAvailability({ tenantId: "club1", sport: "padel", date: "2026-06-15" });
    expect(res.cached).toBe(false);
    expect(res.courts).toHaveLength(1);
    expect(mockGetAvailability).toHaveBeenCalledTimes(1);
    expect(await prisma.playtomicAvailabilityCache.count()).toBe(1);
  });

  it("serves from cache within TTL without refetching", async () => {
    mockGetAvailability.mockResolvedValue({ courts });
    await getCachedAvailability({ tenantId: "club1", sport: "padel", date: "2026-06-15" });
    const res = await getCachedAvailability({ tenantId: "club1", sport: "padel", date: "2026-06-15" });
    expect(res.cached).toBe(true);
    expect(mockGetAvailability).toHaveBeenCalledTimes(1); // not called again
  });

  it("refetches when the entry is older than the TTL", async () => {
    mockGetAvailability.mockResolvedValue({ courts });
    await getCachedAvailability({ tenantId: "club1", sport: "padel", date: "2026-06-15" });
    // Force the entry to be stale
    await prisma.playtomicAvailabilityCache.update({
      where: { cacheKey: "club1|padel|2026-06-15" },
      data: { fetchedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const res = await getCachedAvailability({ tenantId: "club1", sport: "padel", date: "2026-06-15" }, 10 * 60 * 1000);
    expect(res.cached).toBe(false);
    expect(mockGetAvailability).toHaveBeenCalledTimes(2);
  });

  it("serves stale cache when the upstream fetch errors", async () => {
    mockGetAvailability.mockResolvedValueOnce({ courts });
    await getCachedAvailability({ tenantId: "club1", sport: "padel", date: "2026-06-15" });
    await prisma.playtomicAvailabilityCache.update({
      where: { cacheKey: "club1|padel|2026-06-15" },
      data: { fetchedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    mockGetAvailability.mockResolvedValueOnce({ courts: [], error: "playtomic down" });
    const res = await getCachedAvailability({ tenantId: "club1", sport: "padel", date: "2026-06-15" });
    expect(res.courts).toHaveLength(1); // stale data, not empty
  });
});

describe("fetchAvailabilityGrouped", () => {
  it("dedups identical keys into a single upstream fetch", async () => {
    mockGetAvailability.mockResolvedValue({ courts });
    const keys = [
      { tenantId: "club1", sport: "padel", date: "2026-06-15" },
      { tenantId: "club1", sport: "padel", date: "2026-06-15" }, // dup
      { tenantId: "club2", sport: "padel", date: "2026-06-15" },
    ];
    const map = await fetchAvailabilityGrouped(keys);
    expect(mockGetAvailability).toHaveBeenCalledTimes(2); // dedup → 2 unique
    expect(map.get(availabilityKeyStr(keys[0]))).toHaveLength(1);
    expect(map.size).toBe(2);
  });
});

describe("mapWithConcurrency", () => {
  it("processes all items and preserves order", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

describe("purgeStaleAvailabilityCache", () => {
  it("removes only entries older than maxAge", async () => {
    mockGetAvailability.mockResolvedValue({ courts });
    // fresh entry
    await getCachedAvailability({ tenantId: "fresh", sport: "padel", date: "2026-06-15" });
    // stale entry
    await getCachedAvailability({ tenantId: "stale", sport: "padel", date: "2026-06-15" });
    await prisma.playtomicAvailabilityCache.update({
      where: { cacheKey: "stale|padel|2026-06-15" },
      data: { fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });

    const removed = await purgeStaleAvailabilityCache(24 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    expect(await prisma.playtomicAvailabilityCache.count()).toBe(1);
    const remaining = await prisma.playtomicAvailabilityCache.findFirst();
    expect(remaining?.cacheKey).toBe("fresh|padel|2026-06-15");
  });
});
