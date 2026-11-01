#!/bin/sh
set -e

# Testability: production uses /data and /app. The test harness points both at
# a temp directory; nothing else in the script assumes the literal paths.
DATA_DIR="${DATA_DIR:-/data}"
APP_DIR="${APP_DIR:-/app}"
DB="$DATA_DIR/db.sqlite"
PRISMA_BIN="${PRISMA_BIN:-$APP_DIR/node_modules/.bin/prisma}"
DATABASE_URL="${DATABASE_URL:-file:$DB}"
# Explicit kill switch for the off-host backup path. Default true preserves the
# existing behaviour; set false when R2 is known to be unavailable so the app
# does not attempt a restore or run a replica that cannot succeed.
BACKUPS_ENABLED="${BACKUPS_ENABLED:-true}"
export DATA_DIR APP_DIR DB PRISMA_BIN DATABASE_URL BACKUPS_ENABLED

cd "$APP_DIR"

# ── Restore from R2 if DB is missing ─────────────────────────────────────────
if [ "$BACKUPS_ENABLED" = "true" ] && [ ! -f "$DB" ] && [ -n "$LITESTREAM_REPLICA_BUCKET" ]; then
  echo "[startup] Database not found, attempting restore from R2..."
  restore_output="$(litestream restore -config "$APP_DIR/litestream.yml" -if-replica-exists "$DB" 2>&1)" && restore_status=0 || restore_status=$?
  if [ "$restore_status" -eq 0 ]; then
    if [ -f "$DB" ]; then
      echo "[startup] Database restored from R2 backup"
    else
      echo "[startup] No replica found in R2 — starting with fresh database"
    fi
  else
    # A missing replica exits 0 from litestream; a non-zero exit is an auth,
    # permission or network failure. Losing the boot would turn a broken backup
    # path into an outage, so log the cause and continue (the DB is recreated
    # by migrations, and Litestream will retry replication).
    echo "[startup] WARNING: Litestream restore failed (exit $restore_status); booting with a fresh database."
    printf '%s\n' "$restore_output" | tail -5
    echo "[startup] The line above is Litestream's cause (no replica, NotEntitled/permission, or network)."
  fi
fi

# ── Pre-migration backup ─────────────────────────────────────────────────────
if [ -f "$DB" ]; then
  echo "[startup] Checkpointing WAL and backing up the database..."
  checkpoint_output="$(node -e '
    const Database = require(process.env.APP_DIR + "/node_modules/better-sqlite3");
    const db = new Database(process.env.DB, { readonly: false });
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } finally { db.close(); }
  ' 2>&1)" && checkpoint_status=0 || checkpoint_status=$?
  if [ "$checkpoint_status" -ne 0 ]; then
    echo "[startup] WARNING: WAL checkpoint failed (exit $checkpoint_status); preserving sidecars with the backup."
    printf '%s\n' "$checkpoint_output" | tail -3
  fi
  cp "$DB" "$DB.pre-migrate-backup"
  if [ "$checkpoint_status" -ne 0 ]; then
    [ -f "$DB-wal" ] && cp "$DB-wal" "$DB.pre-migrate-backup-wal"
    [ -f "$DB-shm" ] && cp "$DB-shm" "$DB.pre-migrate-backup-shm"
  fi
  echo "[startup] Database backed up to $DB.pre-migrate-backup"
fi

# ── Recover from failed migrations ───────────────────────────────────────────
# If a previous deploy left a migration in a "started but not finished" state,
# `prisma migrate deploy` refuses to run (P3009). The startup script auto-resolves
# the failure as a rollback so the new migration files in the image can take over.
#
# This is intentionally aggressive because the alternative is the app being
# permanently down. The failed-migration is logged loudly for post-mortem.
#
# Uses better-sqlite3 directly instead of @prisma/client: the Prisma 7
# prisma-client generator emits a custom module in src/lib/__generated__/prisma,
# so the old require("@prisma/client") default .prisma/client/default no longer
# exists in the image. These queries only touch raw SQL, so better-sqlite3 is
# the right tool and is already a production dependency.
if [ -f "$DB" ]; then
  echo "[startup] Checking for failed migrations and recovering in one shot..."
  node -e '
    const Database = require(process.env.APP_DIR + "/node_modules/better-sqlite3");
    const DB = process.env.DB;
    const db = new Database(DB, { readonly: false });
    const cutoff = new Date(Date.now() - 120000).toISOString();
    try {
      const failed = db.prepare(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL AND started_at < ?"
      ).all(cutoff);
      if (failed.length > 0) {
        console.log(`[startup] WARNING: detected ${failed.length} failed migration(s) from a previous deploy`);
        console.log("[startup] Restoring database from pre-migration backup and marking as rolled back...");
        db.close();
        // Restore from backup first to get a clean schema state. The WAL and
        // shm of the *live* file carry newer frames than the backup; replaying
        // them onto the restored image would corrupt it, so drop them exactly
        // as Litestream restore does. A backup taken after a failed
        // checkpoint carries its own sidecars; restore those if present.
        const fs = require("fs");
        if (fs.existsSync(DB + ".pre-migrate-backup")) {
          fs.rmSync(DB + "-wal", { force: true });
          fs.rmSync(DB + "-shm", { force: true });
          fs.copyFileSync(DB + ".pre-migrate-backup", DB);
          if (fs.existsSync(DB + ".pre-migrate-backup-wal")) {
            fs.copyFileSync(DB + ".pre-migrate-backup-wal", DB + "-wal");
          }
          if (fs.existsSync(DB + ".pre-migrate-backup-shm")) {
            fs.copyFileSync(DB + ".pre-migrate-backup-shm", DB + "-shm");
          }
          console.log("[startup] Database restored from pre-migrate backup");
        }
        // Mark failed migrations as rolled back so prisma migrate deploy retries them
        const db2 = new Database(DB, { readonly: false });
        const markRolledBack = db2.prepare(
          "UPDATE _prisma_migrations SET rolled_back_at = CURRENT_TIMESTAMP WHERE migration_name = ? AND finished_at IS NULL"
        );
        for (const m of failed) {
          try {
            markRolledBack.run(m.migration_name);
            console.log(`[startup] Marked ${m.migration_name} as rolled back`);
          } catch (e) {
            console.error(`[startup] Failed to mark ${m.migration_name} as rolled back:`, e.message);
          }
        }
        db2.close();
      } else {
        console.log("[startup] No failed migrations detected.");
      }
    } catch (e) {
      console.error("[startup] Failed-migration check failed (non-fatal):", e.message);
    } finally {
      if (db.open) db.close();
    }
  '
fi

echo "[startup] Running database migrations..."

# Run migrations — if this fails, the deploy fails and Fly keeps the old machine.
"$PRISMA_BIN" migrate deploy

# ── Post-migration verification ──────────────────────────────────────────────
# Defense-in-depth check: confirm the DB schema matches the migration files
# in the image. Catches cases where the image is stale or release_command was
# skipped. Non-fatal: we want the app to still serve, but log loudly so the
# operator notices. See src/lib/schemaCheck.server.ts for the library version
# exposed at GET /api/health/migration.
echo "[startup] Verifying schema is in sync with migrations directory..."
if ! "$PRISMA_BIN" migrate status >/tmp/migrate-status.log 2>&1; then
  echo "[startup] WARNING: schema drift detected after migrate deploy:"
  cat /tmp/migrate-status.log
  echo "[startup] App will start, but endpoints touching missing tables will fail."
fi

# ── Start app ─────────────────────────────────────────────────────────────────
if [ "$BACKUPS_ENABLED" = "true" ] && [ -n "$LITESTREAM_REPLICA_BUCKET" ]; then
  echo "[startup] Starting app with Litestream replication..."
  exec litestream replicate -exec "node scripts/server.mjs" -config "$APP_DIR/litestream.yml"
else
  if [ "$BACKUPS_ENABLED" = "true" ]; then
    echo "[startup] WARNING: BACKUPS_ENABLED=true but LITESTREAM_REPLICA_BUCKET is not set; starting without replication."
  else
    echo "[startup] Backups disabled (BACKUPS_ENABLED=false); starting without Litestream replication."
  fi
  exec node scripts/server.mjs
fi
