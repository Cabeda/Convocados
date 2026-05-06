import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/health";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

beforeEach(async () => {
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
    const spy = vi.spyOn(execSync as any, "constructor").mockImplementation(() => {});
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

  it("returns 503 when database query fails", async () => {
    // Spy on $queryRaw to throw
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("DB down"));
    try {
      const res = await GET(ctx());
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("error");
      expect(body.message).toContain("DB down");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns default message when error has no message", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(null);
    try {
      const res = await GET(ctx());
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.message).toBe("db unreachable");
    } finally {
      spy.mockRestore();
    }
  });
});
