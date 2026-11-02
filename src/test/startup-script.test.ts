import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

const root = resolve(__dirname, "../..");
let dir: string;
let dataDir: string;
let binDir: string;

function stub(name: string, body: string) {
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function runStart(extraEnv: Record<string, string> = {}) {
  return execFileSync("sh", ["scripts/start.sh"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      DATA_DIR: dataDir,
      APP_DIR: root,
      PRISMA_BIN: join(binDir, "prisma"),
      DATABASE_URL: `file:${join(dataDir, "db.sqlite")}`,
      LITESTREAM_REPLICA_BUCKET: "test-bucket",
      ...extraEnv,
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "startup-test-"));
  dataDir = join(dir, "data");
  binDir = join(dir, "bin");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  // The restore stub fails like a broken R2 credential; replicate is a no-op so
  // the final exec does not start a real server.
  stub(
    "litestream",
    `if [ "$1" = "restore" ]; then
  echo "NotEntitled: Please enable R2 through the Cloudflare Dashboard." >&2
  exit 1
fi
exit 0`,
  );
  stub("prisma", "exit 0");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("scripts/start.sh startup recovery", () => {
  it("logs a failed restore cause and still boots", () => {
    const output = runStart();

    expect(output).toContain("Litestream restore failed");
    expect(output).toContain("NotEntitled");
    expect(output).toContain("booting with a fresh database");
    expect(existsSync(join(dataDir, "db.sqlite"))).toBe(false);
  });

  it("skips restore and replication when BACKUPS_ENABLED=false", () => {
    // The final exec is `node scripts/server.mjs`; stub it so the test does not
    // start the real app. No DB exists, so the backup/migration node checks do
    // not run.
    stub("node", "exit 0");

    const output = runStart({ BACKUPS_ENABLED: "false" });

    expect(output).toContain("Backups disabled (BACKUPS_ENABLED=false)");
    expect(output).not.toContain("attempting restore from R2");
    expect(output).not.toContain("Starting app with Litestream replication");
  });

  it("prints one greppable line when no database exists at boot", () => {
    stub("node", "exit 0");

    const output = runStart({ BACKUPS_ENABLED: "false" });

    expect(output).toContain("FRESH_DATABASE");
    expect(output.match(/FRESH_DATABASE/g)).toHaveLength(1);
  });

  it("exports the normalized backup switch that health reads", () => {
    // With the switch on, start.sh execs through Litestream; the stub prints
    // the exported values so the test can see what the app would receive.
    stub(
      "litestream",
      'echo "NORMALIZED=$BACKUPS_ENABLED_NORMALIZED ACTIVE=$BACKUPS_ACTIVE"',
    );

    const output = runStart({ BACKUPS_ENABLED: "TRUE" });

    expect(output).toContain("NORMALIZED=true");
    expect(output).toContain("ACTIVE=true");
  });

  it("exports BACKUPS_ACTIVE=false when the switch is not true", () => {
    stub(
      "node",
      'echo "NORMALIZED=$BACKUPS_ENABLED_NORMALIZED ACTIVE=$BACKUPS_ACTIVE"',
    );

    const output = runStart({ BACKUPS_ENABLED: "1" });

    expect(output).toContain("NORMALIZED=false");
    expect(output).toContain("ACTIVE=false");
  });

  it("checkpoints the WAL before the pre-migration backup", () => {
    const dbPath = join(dataDir, "db.sqlite");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    db.exec("CREATE TABLE t (n INTEGER)");
    const insert = db.prepare("INSERT INTO t (n) VALUES (?)");
    for (let i = 0; i < 100; i++) insert.run(i);
    // Leave the connection open so the frames stay in -wal: the script must
    // checkpoint them instead of copying only the main file.
    expect(statSync(`${dbPath}-wal`).size).toBeGreaterThan(0);

    try {
      const output = runStart();
      expect(output).toContain("Checkpointing WAL");
      expect(output).toContain("Database backed up");
    } finally {
      db.close();
    }

    const backup = new Database(`${dbPath}.pre-migrate-backup`, { readonly: true });
    try {
      expect((backup.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c).toBe(100);
    } finally {
      backup.close();
    }
  });

  it("keeps the pre-deploy backup when a failed migration restores it", () => {
    const dbPath = join(dataDir, "db.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE t (keep TEXT);
      INSERT INTO t (keep) VALUES ('good');
      CREATE TABLE _prisma_migrations (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        finished_at DATETIME,
        migration_name TEXT NOT NULL,
        logs TEXT,
        rolled_back_at DATETIME,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        applied_steps_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.close();

    // The copy a previous boot took, before the deploy that failed.
    execFileSync("cp", [dbPath, `${dbPath}.pre-migrate-backup`]);

    // The failed deploy: a column the backup does not have, plus an unfinished
    // migration row. Copying the live file over the backup here is the bug.
    const failed = new Database(dbPath);
    failed.exec("ALTER TABLE t ADD COLUMN marker TEXT");
    failed
      .prepare(
        `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at)
         VALUES ('m1', 'checksum', '20260101000000_boom', ?)`,
      )
      .run(new Date(Date.now() - 600_000).toISOString());
    failed.close();

    const output = runStart();

    expect(output).toContain("keeping the existing pre-migrate backup");
    expect(output).toContain("Database restored from pre-migrate backup");

    const live = new Database(dbPath, { readonly: true });
    try {
      const columns = live.prepare("PRAGMA table_info(t)").all() as { name: string }[];
      expect(columns.map((column) => column.name)).not.toContain("marker");
    } finally {
      live.close();
    }
  });

  it("refreshes the backup on a boot with no failed migration", () => {
    const dbPath = join(dataDir, "db.sqlite");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('fresh');");
    db.close();

    const stale = new Database(`${dbPath}.pre-migrate-backup`);
    stale.exec("CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('stale');");
    stale.close();

    expect(runStart()).toContain("Database backed up");

    const backup = new Database(`${dbPath}.pre-migrate-backup`, { readonly: true });
    try {
      expect((backup.prepare("SELECT v FROM t").get() as { v: string }).v).toBe("fresh");
    } finally {
      backup.close();
    }
  });
});
