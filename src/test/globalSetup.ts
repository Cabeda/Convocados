import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const PRISMA_DIR = path.resolve(process.cwd(), "prisma");
const MIGRATIONS_DIR = path.join(PRISMA_DIR, "migrations");
const BASE_DB = path.join(PRISMA_DIR, "test.db");

function applyMigrations(db: Database.Database) {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((d) => fs.statSync(path.join(MIGRATIONS_DIR, d)).isDirectory())
    .sort();

  for (const dir of dirs) {
    const dirPath = path.join(MIGRATIONS_DIR, dir);
    const sqlFiles = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of sqlFiles) {
      const sql = fs.readFileSync(path.join(dirPath, f), "utf8");
      db.exec(sql);
    }
  }
}

function seedMigrationHistory(db: Database.Database) {
  db.exec(
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
    .filter((d) => fs.statSync(path.join(MIGRATIONS_DIR, d)).isDirectory())
    .sort();

  const insert = db.prepare(
    "INSERT OR IGNORE INTO `_prisma_migrations` " +
      "(`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) " +
      "VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)",
  );

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
    insert.run(id, checksum, now, dir, now, sqlFiles.length);
  }
}

/**
 * Best-effort cleanup of DB files left behind by runs that crashed before
 * teardown. Age-gated so a live concurrent run's files are never removed.
 */
function sweepStaleTestDbs(maxAgeMs = 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let files: string[];
  try {
    files = fs.readdirSync(PRISMA_DIR);
  } catch {
    return;
  }
  for (const file of files) {
    if (
      file === "test.db" ||
      file.startsWith("test.db-") ||
      file.startsWith("test.db.tmp-") ||
      /^test-worker-.*\.db(-wal|-shm)?(\.initialized)?$/.test(file) ||
      /^test-base-.*\.db(-wal|-shm)?$/.test(file)
    ) {
      const full = path.join(PRISMA_DIR, file);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Rebuild the shared schema-only `test.db` that each worker copies from.
 *
 * Vitest runs `globalSetup` once per project process, so this can run
 * concurrently with another project's worker copying `test.db`. Never delete
 * the file in place and never unlink it during a run: build the DB at a
 * pid-scoped temp path, then atomically rename it over `test.db`. A concurrent
 * `copyFileSync` either opens the old or the new complete inode — never a
 * missing or half-written file (which previously produced ENOENT and
 * SQLITE_CORRUPT under `vitest run --coverage`).
 */
export async function setup() {
  sweepStaleTestDbs();

  const tmp = path.join(PRISMA_DIR, `test.db.tmp-${process.pid}`);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      fs.unlinkSync(`${tmp}${suffix}`);
    } catch {
      // best effort
    }
  }

  const db = new Database(tmp);
  try {
    applyMigrations(db);
    seedMigrationHistory(db);
  } finally {
    db.close();
  }

  fs.renameSync(tmp, BASE_DB);
  process.env.DATABASE_URL = `file:./test.db`;
}

export function teardown() {
  // Intentionally does NOT delete test.db / worker DBs: other project
  // processes may still be reading them. Stale files are swept on the next
  // setup() once they age out.
  sweepStaleTestDbs();
}
