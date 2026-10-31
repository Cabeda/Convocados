import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/health";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

beforeEach(async () => {
  await prisma.schedulerHeartbeat.deleteMany();
  await prisma.scheduledJob.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
});

function ctx() {
  return {
    request: new Request("http://localhost/api/health", { method: "GET" }),
    params: {},
    url: new URL("http://localhost/api/health"),
  } as any;
}

describe("GET /api/health", () => {
  it("returns ok status with db info", async () => {
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBeDefined();
    expect(body.db.journalMode).toBe("wal");
    expect(body.db.writable).toBe(true);
  });

  it("includes SQLite page/freelist counts and WAL size", async () => {
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.db.pageCount).toBe("number");
    expect(typeof body.db.freelistCount).toBe("number");
    expect(typeof body.db.walSizeBytes).toBe("number");
  });

  it("does not include litestream in non-production env", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const res = await GET(ctx());
      const body = await res.json();
      expect(body.litestream).toBeUndefined();
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  it("includes litestream running=false when pgrep fails", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await GET(ctx());
      const body = await res.json();
      expect(body.litestream).toBeDefined();
      expect(body.litestream.running).toBe(false);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  it("includes litestream running=true when pgrep succeeds", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { execSync } = await import("node:child_process");
    vi.spyOn(execSync as any, "constructor").mockImplementation(() => {});
    // Actually, execSync is a function. We need to mock the module import.
    // Let's use vi.doMock instead, but it's tricky with dynamic import.
    // Alternative: mock the module before importing health.
    vi.doMock("node:child_process", () => ({
      execSync: vi.fn(() => Buffer.from("1234")),
    }));
    try {
      // Re-import health to pick up the mock
      const { GET: getHealth } = await import("~/pages/api/health");
      const res = await getHealth(ctx());
      const body = await res.json();
      expect(body.litestream).toBeDefined();
      expect(body.litestream.running).toBe(true);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      vi.doUnmock("node:child_process");
    }
  });

  it("omits scheduler field in non-production env", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const res = await GET(ctx());
      const body = await res.json();
      expect(body.scheduler).toBeUndefined();
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  it("reports the last successful sync and stays healthy when it is fresh", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    await prisma.schedulerHeartbeat.upsert({
      where: { id: "scheduler" },
      create: { id: "scheduler", lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
    });
    const nowIso = new Date().toISOString();
    vi.doMock("node:child_process", () => ({
      execSync: vi.fn((cmd: string) => {
        if (cmd.startsWith("pgrep")) return Buffer.from("1234");
        return JSON.stringify({
          databases: [{ path: "/data/db.sqlite", status: "replicating", last_sync_at: nowIso }],
        });
      }),
    }));
    try {
      vi.resetModules();
      const { GET: getHealth } = await import("~/pages/api/health");
      const res = await getHealth(ctx());
      const body = await res.json();
      expect(body.litestream).toEqual({
        running: true,
        status: "replicating",
        lastSyncAt: nowIso,
        syncAgeSeconds: expect.any(Number),
      });
      expect(body.litestream.syncAgeSeconds).toBeLessThan(60);
      expect(body.degraded).toBeUndefined();
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      vi.doUnmock("node:child_process");
    }
  });

  it("degrades when the daemon is up but the last sync is stale", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    await prisma.schedulerHeartbeat.upsert({
      where: { id: "scheduler" },
      create: { id: "scheduler", lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
    });
    const staleIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    vi.doMock("node:child_process", () => ({
      execSync: vi.fn((cmd: string) => {
        if (cmd.startsWith("pgrep")) return Buffer.from("1234");
        return JSON.stringify({
          databases: [{ path: "/data/db.sqlite", status: "replicating", last_sync_at: staleIso }],
        });
      }),
    }));
    try {
      vi.resetModules();
      const { GET: getHealth } = await import("~/pages/api/health");
      const res = await getHealth(ctx());
      const body = await res.json();
      expect(body.litestream.running).toBe(true);
      expect(body.litestream.status).toBe("replicating");
      expect(body.litestream.syncAgeSeconds).toBeGreaterThan(24 * 60 * 60);
      expect(body.degraded).toBe(true);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      vi.doUnmock("node:child_process");
    }
  });

  it("degrades when replication is stopped even with a fresh sync", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    await prisma.schedulerHeartbeat.upsert({
      where: { id: "scheduler" },
      create: { id: "scheduler", lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
    });
    vi.doMock("node:child_process", () => ({
      execSync: vi.fn((cmd: string) => {
        if (cmd.startsWith("pgrep")) return Buffer.from("1234");
        return JSON.stringify({
          databases: [{ path: "/data/db.sqlite", status: "stopped", last_sync_at: new Date().toISOString() }],
        });
      }),
    }));
    try {
      vi.resetModules();
      const { GET: getHealth } = await import("~/pages/api/health");
      const res = await getHealth(ctx());
      const body = await res.json();
      expect(body.litestream.status).toBe("stopped");
      expect(body.degraded).toBe(true);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      vi.doUnmock("node:child_process");
    }
  });

  it("degrades when a replicating daemon has no successful sync after a day", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    await prisma.schedulerHeartbeat.upsert({
      where: { id: "scheduler" },
      create: { id: "scheduler", lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
    });
    vi.doMock("node:child_process", () => ({
      execSync: vi.fn((cmd: string) => {
        if (cmd.startsWith("pgrep")) return Buffer.from("1234");
        return JSON.stringify({ databases: [{ path: "/data/db.sqlite", status: "replicating" }] });
      }),
    }));
    const uptime = vi.spyOn(process, "uptime").mockReturnValue(25 * 60 * 60);
    try {
      vi.resetModules();
      const { GET: getHealth } = await import("~/pages/api/health");
      const res = await getHealth(ctx());
      const body = await res.json();
      expect(body.litestream.status).toBe("replicating");
      expect(body.litestream.lastSyncAt).toBeNull();
      expect(body.degraded).toBe(true);
    } finally {
      uptime.mockRestore();
      process.env.NODE_ENV = oldNodeEnv;
      vi.doUnmock("node:child_process");
    }
  });

  it("reports scheduler running=true when heartbeat is fresh in production", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await prisma.schedulerHeartbeat.upsert({
        where: { id: "scheduler" },
        create: { id: "scheduler", lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      });
      const res = await GET(ctx());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.scheduler).toEqual({ running: true, failedJobs: 0 });
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  it("reports dead-lettered scheduled jobs in production", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await prisma.schedulerHeartbeat.upsert({
        where: { id: "scheduler" },
        create: { id: "scheduler", lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      });
      await prisma.scheduledJob.create({
        data: {
          type: "reminder_24h",
          runAt: new Date(Date.now() - 3600_000),
          failedAt: new Date(),
          retryCount: 2,
        },
      });
      const res = await GET(ctx());
      expect(res.status).toBe(200);
      const body = await res.json();
      // Dead letters don't fail the health check, but they must be visible.
      expect(body.scheduler).toEqual({ running: true, failedJobs: 1 });
      expect(body.status).toBe("ok");
      // This test runs without a Litestream daemon, so `degraded` is set for
      // that separate reason; dead letters themselves never degrade health.
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  it("reports scheduler running=false but stays healthy when heartbeat is stale (deadlock prevention)", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await prisma.schedulerHeartbeat.upsert({
        where: { id: "scheduler" },
        create: { id: "scheduler", lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) },
        update: { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) },
      });
      const res = await GET(ctx());
      // 200 (not 503): a 503 would remove the instance from the load balancer,
      // and the scheduler — which polls via the public URL — could never reach
      // it again to refresh the heartbeat, deadlocking the app.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.scheduler).toEqual({ running: false, failedJobs: 0 });
      expect(body.degraded).toBe(true);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  it("reports scheduler running=false but stays healthy when no heartbeat exists", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await prisma.schedulerHeartbeat.deleteMany();
      const res = await GET(ctx());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.scheduler).toEqual({ running: false, failedJobs: 0 });
      expect(body.degraded).toBe(true);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  it("returns 503 without leaking the internal error text", async () => {
    // Spy on $queryRaw to throw
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("DB down at /data/secret.db"));
    try {
      const res = await GET(ctx());
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("error");
      expect(body.message).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns 503 with no message when the error has none", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(null);
    try {
      const res = await GET(ctx());
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("error");
      expect(body.message).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
