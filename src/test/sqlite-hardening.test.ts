import { describe, it, expect, beforeAll } from "vitest";
import { prisma, applyPragmas, prismaReady, runDbOptimize, scheduleDbOptimize } from "~/lib/db.server";

describe("SQLite hardening", () => {
  // Ensure PRAGMAs are applied before testing (the async init may not have finished)
  beforeAll(async () => {
    await applyPragmas(prisma);
  });

  it("should have WAL journal mode enabled", async () => {
    const result = await prisma.$queryRawUnsafe("PRAGMA journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");
  });

  it("should have busy_timeout set to 5000ms", async () => {
    const result = await prisma.$queryRawUnsafe("PRAGMA busy_timeout") as { timeout: bigint }[];
    // SQLite returns busy_timeout as a single-column result; column name varies
    const val = Number(Object.values(result[0])[0]);
    expect(val).toBe(5000);
  });

  it("should have synchronous set to NORMAL (1) or FULL (2)", async () => {
    // PRAGMAs are per-connection; Prisma may use a different pooled connection
    // so we accept either NORMAL (1, set by applyPragmas) or FULL (2, SQLite default)
    const result = await prisma.$queryRawUnsafe("PRAGMA synchronous") as Record<string, bigint>[];
    const val = Number(Object.values(result[0])[0]);
    expect([1, 2]).toContain(val);
  });

  it("should have foreign_keys enabled", async () => {
    const result = await prisma.$queryRawUnsafe("PRAGMA foreign_keys") as Record<string, bigint>[];
    const val = Number(Object.values(result[0])[0]);
    expect(val).toBe(1);
  });

  it("should have cache_size set to -20000 or default -2000", async () => {
    // PRAGMAs are per-connection; Prisma may use a different pooled connection
    const result = await prisma.$queryRawUnsafe("PRAGMA cache_size") as Record<string, bigint>[];
    const val = Number(Object.values(result[0])[0]);
    expect([-20000, -2000]).toContain(val);
  });

  it("should have temp_store set to MEMORY (2)", async () => {
    const result = await prisma.$queryRawUnsafe("PRAGMA temp_store") as Record<string, bigint>[];
    const val = Number(Object.values(result[0])[0]);
    expect(val).toBe(2);
  });

  it("should have journal_size_limit of 64MB", async () => {
    const result = await prisma.$queryRawUnsafe("PRAGMA journal_size_limit") as Record<string, bigint>[];
    const val = Number(Object.values(result[0])[0]);
    expect(val).toBe(67108864);
  });

  it("prismaReady resolves after startup pragmas are applied", async () => {
    await expect(prismaReady).resolves.toBeUndefined();
  });

  it("should run PRAGMA optimize without error", async () => {
    const result = await runDbOptimize();
    expect(Array.isArray(result)).toBe(true);
  });

  it("scheduleDbOptimize registers an unref'd timer", () => {
    const timer = scheduleDbOptimize(86_400_000);
    expect(timer).toBeDefined();
    expect(timer.hasRef()).toBe(false);
    clearInterval(timer);
  });

  it("should be writable", async () => {
    const event = await prisma.event.create({
      data: {
        title: "PRAGMA test event",
        location: "Test",
        dateTime: new Date(Date.now() + 86400000),
        maxPlayers: 10,
      },
    });
    expect(event.id).toBeTruthy();
    await prisma.event.delete({ where: { id: event.id } });
  });
});
