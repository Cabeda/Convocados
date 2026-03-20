import { describe, it, expect, beforeAll } from "vitest";
import { prisma, applyPragmas } from "~/lib/db.server";

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

  it("should have synchronous set to NORMAL (1)", async () => {
    const result = await prisma.$queryRawUnsafe("PRAGMA synchronous") as Record<string, bigint>[];
    const val = Number(Object.values(result[0])[0]);
    expect(val).toBe(1); // NORMAL = 1
  });

  it("should have foreign_keys enabled", async () => {
    const result = await prisma.$queryRawUnsafe("PRAGMA foreign_keys") as Record<string, bigint>[];
    const val = Number(Object.values(result[0])[0]);
    expect(val).toBe(1);
  });

  it("should have cache_size set to -20000 (20MB)", async () => {
    const result = await prisma.$queryRawUnsafe("PRAGMA cache_size") as Record<string, bigint>[];
    const val = Number(Object.values(result[0])[0]);
    expect(val).toBe(-20000);
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
