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
});
