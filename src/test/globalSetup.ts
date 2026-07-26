import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const PRISMA_DIR = path.resolve(process.cwd(), "prisma");
const MIGRATIONS_DIR = path.join(PRISMA_DIR, "migrations");

function cleanTestDb() {
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

export async function setup() {
  cleanTestDb();

  const dbPath = path.join(PRISMA_DIR, "test.db");
  const db = new Database(dbPath);
  try {
    applyMigrations(db);
    seedMigrationHistory(db);
  } finally {
    db.close();
  }

  process.env.DATABASE_URL = `file:./test.db`;
}

export function teardown() {
  cleanTestDb();
}
