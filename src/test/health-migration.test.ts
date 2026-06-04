import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/health/migration";

let tmpDir: string;
const ORIGINAL_DIR = process.env.MIGRATIONS_DIR;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "health-migration-test-"));
  process.env.MIGRATIONS_DIR = tmpDir;
  await prisma.$executeRawUnsafe("DELETE FROM _prisma_migrations");
});

afterEach(() => {
  if (ORIGINAL_DIR === undefined) delete process.env.MIGRATIONS_DIR;
  else process.env.MIGRATIONS_DIR = ORIGINAL_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

function ctx() {
  return {
    request: new Request("http://localhost/api/health/migration", { method: "GET" }),
    params: {},
    url: new URL("http://localhost/api/health/migration"),
  } as any;
}

async function recordMigration(name: string) {
  await prisma.$executeRawUnsafe(
    "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
    `id-${name}`, "x", new Date().toISOString(), name, "", new Date().toISOString(), 1,
  );
}

describe("GET /api/health/migration", () => {
  it("returns in_sync when DB and filesystem match", async () => {
    mkdirSync(join(tmpDir, "20260501000000_init"));
    writeFileSync(join(tmpDir, "20260501000000_init", "migration.sql"), "-- init");
    mkdirSync(join(tmpDir, "20260512133435_add_mvp_elo"));
    writeFileSync(join(tmpDir, "20260512133435_add_mvp_elo", "migration.sql"), "-- mvp");
    await recordMigration("20260501000000_init");
    await recordMigration("20260512133435_add_mvp_elo");

    const res = await GET(ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("in_sync");
    expect(body.applied).toEqual(["20260501000000_init", "20260512133435_add_mvp_elo"]);
    expect(body.missingFromDb).toEqual([]);
    expect(body.missingFromFs).toEqual([]);
  });

  it("returns drift when a migration file is on disk but not applied", async () => {
    mkdirSync(join(tmpDir, "20260501000000_init"));
    writeFileSync(join(tmpDir, "20260501000000_init", "migration.sql"), "-- init");
    mkdirSync(join(tmpDir, "20260603155629_add_event_follow"));
    writeFileSync(join(tmpDir, "20260603155629_add_event_follow", "migration.sql"), "-- follow");
    await recordMigration("20260501000000_init");

    const res = await GET(ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("drift");
    expect(body.missingFromDb).toEqual(["20260603155629_add_event_follow"]);
  });
});
