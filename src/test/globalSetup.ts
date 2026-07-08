import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

// The SQLite DB path is resolved by Prisma relative to the schema file's
// directory (`prisma/`), not the working directory. So `file:./test.db`
// in DATABASE_URL always lands at `prisma/test.db` regardless of cwd.
const PRISMA_DIR = path.resolve(__dirname, "../../prisma");
const MIGRATIONS_DIR = path.join(PRISMA_DIR, "migrations");

function cleanTestDb() {
  // Remove the test DB (and WAL companions) and any worker DBs.
  for (const file of fs.readdirSync(PRISMA_DIR)) {
    if (
      /^test-base\.db/.test(file) ||
      /^test-worker-\d+\.db/.test(file) ||
      file === "test.db" ||
      file === "test.db-journal" ||
      file === "test.db-wal" ||
      file === "test.db-shm"
    ) {
      try {
        fs.unlinkSync(path.join(PRISMA_DIR, file));
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Create the `_prisma_migrations` table and populate it with all
 * migration files on disk, marked as applied. This makes the test DB
 * look like a real `migrate deploy` run — required for the migration-drift
 * checks in `health-migration` and `schemaCheck`.
 *
 * `prisma db push` doesn't create this table (it bypasses migrations),
 * so we recreate the table and seed it ourselves with sha256 checksums
 * matching Prisma 5+ format.
 */
async function seedMigrationHistory() {
  const cli = new PrismaClient({ datasourceUrl: "file:./test.db" });
  try {
    await cli.$executeRawUnsafe(
      "CREATE TABLE IF NOT EXISTS `_prisma_migrations` (" +
        "`id` TEXT NOT NULL PRIMARY KEY, " +
        "`checksum` TEXT NOT NULL, " +
        "`finished_at` DATETIME, " +
        "`migration_name` TEXT NOT NULL, " +
        "`logs` TEXT, " +
        "`rolled_back_at` DATETIME, " +
        "`started_at` DATETIME NOT NULL, " +
        "`applied_steps_count` INTEGER NOT NULL DEFAULT 0" +
        ")",
    );
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((d) => fs.statSync(path.join(MIGRATIONS_DIR, d)).isDirectory());
    for (const dir of dirs) {
      const dirPath = path.join(MIGRATIONS_DIR, dir);
      const sqlFiles = fs
        .readdirSync(dirPath)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      const hash = crypto.createHash("sha256");
      for (const f of sqlFiles) {
        hash.update(fs.readFileSync(path.join(dirPath, f), "utf8"));
      }
      const checksum = hash.digest("hex");
      const id = crypto.randomBytes(12).toString("hex");
      const now = new Date().toISOString();
      await cli.$executeRawUnsafe(
        "INSERT OR IGNORE INTO `_prisma_migrations` " +
          "(`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) " +
          "VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)",
        id,
        checksum,
        now,
        dir,
        now,
        sqlFiles.length,
      );
    }
  } finally {
    await cli.$disconnect();
  }
}

export async function setup() {
  cleanTestDb();

  // 1. Apply the schema. We use `db push` (not `migrate deploy`) because
  // `migrate deploy` against a non-existent SQLite file is a no-op on
  // Prisma 6.x — it says "no pending migrations" without creating the
  // file. `db push` is a hard schema sync — exactly what we want for an
  // ephemeral test DB.
  process.env.DATABASE_URL = "file:./test.db";
  execSync("npx prisma db push", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });

  // 2. Seed the migration history so migration-drift checks pass.
  await seedMigrationHistory();
}

export function teardown() {
  cleanTestDb();
}
