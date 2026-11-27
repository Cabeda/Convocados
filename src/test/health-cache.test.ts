import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/health";

beforeEach(async () => {
  // A production boot with the backup path explicitly disabled keeps the
  // litestream branch out of the probe and leaves the body non-degraded, so a
  // healthy response is the one the cache is allowed to keep.
  process.env.NODE_ENV = "production";
  process.env.BACKUPS_ENABLED_NORMALIZED = "false";
  process.env.BACKUPS_ACTIVE = "false";
  delete process.env.BACKUPS_ENABLED;
  delete process.env.APP_BOOT_AT;
  await prisma.$executeRawUnsafe(
    "UPDATE _prisma_migrations SET started_at = ?",
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  );
  await prisma.schedulerHeartbeat.deleteMany();
  await prisma.scheduledJob.deleteMany();
  await prisma.event.deleteMany();
  await prisma.schedulerHeartbeat.create({
    data: { id: "scheduler", lastSeenAt: new Date() },
  });
});

function ctx() {
  return {
    request: new Request("http://localhost/api/health", { method: "GET" }),
    params: {},
    url: new URL("http://localhost/api/health"),
  } as any;
}

describe("GET /api/health probe cache", () => {
  it("runs event.count and countFailedJobs at most once for probes inside the TTL", async () => {
    const eventCount = vi.spyOn(prisma.event, "count");
    const failedJobCount = vi.spyOn(prisma.scheduledJob, "count");

    try {
      const first = await GET(ctx());
      const second = await GET(ctx());

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(eventCount).toHaveBeenCalledTimes(1);
      expect(failedJobCount).toHaveBeenCalledTimes(1);

      const body = await second.json();
      expect(body.status).toBe("ok");
      expect(body.degraded).toBeUndefined();
      expect(body.litestream).toEqual({
        enabled: false,
        running: false,
        status: null,
        lastSyncAt: null,
        syncAgeSeconds: null,
      });
      expect(body.scheduler).toEqual({ running: true, failedJobs: 0 });
    } finally {
      eventCount.mockRestore();
      failedJobCount.mockRestore();
    }
  });
});
