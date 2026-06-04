import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "~/lib/db.server";
import { checkSchemaDrift } from "~/lib/schemaCheck.server";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "schema-check-test-"));
  // Ensure the DB is in a known state (no applied migrations).
  await prisma.$executeRawUnsafe("DELETE FROM _prisma_migrations");
});

describe("checkSchemaDrift", () => {
  it("returns no drift when applied migrations match the filesystem", async () => {
    mkdirSync(join(tmpDir, "20260501000000_init"));
    writeFileSync(join(tmpDir, "20260501000000_init", "migration.sql"), "-- init");
    mkdirSync(join(tmpDir, "20260512133435_add_mvp_elo"));
    writeFileSync(join(tmpDir, "20260512133435_add_mvp_elo", "migration.sql"), "-- mvp");

    await prisma.$executeRawUnsafe(
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "id1", "x", new Date().toISOString(), "20260501000000_init", "", new Date().toISOString(), 1,
    );
    await prisma.$executeRawUnsafe(
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "id2", "x", new Date().toISOString(), "20260512133435_add_mvp_elo", "", new Date().toISOString(), 1,
    );

    const result = await checkSchemaDrift(prisma, tmpDir);
    expect(result.hasDrift).toBe(false);
    expect(result.missingFromDb).toEqual([]);
    expect(result.missingFromFs).toEqual([]);
  });

  it("detects migrations on disk that are not applied to the database", async () => {
    mkdirSync(join(tmpDir, "20260501000000_init"));
    writeFileSync(join(tmpDir, "20260501000000_init", "migration.sql"), "-- init");
    mkdirSync(join(tmpDir, "20260603155629_add_event_follow"));
    writeFileSync(join(tmpDir, "20260603155629_add_event_follow", "migration.sql"), "-- follow");

    await prisma.$executeRawUnsafe(
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "id1", "x", new Date().toISOString(), "20260501000000_init", "", new Date().toISOString(), 1,
    );

    const result = await checkSchemaDrift(prisma, tmpDir);
    expect(result.hasDrift).toBe(true);
    expect(result.missingFromDb).toEqual(["20260603155629_add_event_follow"]);
    expect(result.missingFromFs).toEqual([]);
  });

  it("detects migrations applied to the DB that are missing from disk (rolled back)", async () => {
    mkdirSync(join(tmpDir, "20260501000000_init"));
    writeFileSync(join(tmpDir, "20260501000000_init", "migration.sql"), "-- init");

    await prisma.$executeRawUnsafe(
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "id1", "x", new Date().toISOString(), "20260501000000_init", "", new Date().toISOString(), 1,
    );
    await prisma.$executeRawUnsafe(
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "id2", "x", new Date().toISOString(), "20260603155629_add_event_follow", "", new Date().toISOString(), 1,
    );

    const result = await checkSchemaDrift(prisma, tmpDir);
    expect(result.hasDrift).toBe(true);
    expect(result.missingFromDb).toEqual([]);
    expect(result.missingFromFs).toEqual(["20260603155629_add_event_follow"]);
  });

  it("returns no drift when both DB and disk have no migrations (fresh DB)", async () => {
    const result = await checkSchemaDrift(prisma, tmpDir);
    expect(result.hasDrift).toBe(false);
    expect(result.missingFromDb).toEqual([]);
    expect(result.missingFromFs).toEqual([]);
  });
});
