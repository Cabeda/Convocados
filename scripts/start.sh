#!/bin/sh
set -e

DATABASE_URL="${DATABASE_URL:-file:/data/db.sqlite}"
export DATABASE_URL

# ── Restore from R2 if DB is missing ─────────────────────────────────────────
if [ ! -f /data/db.sqlite ] && [ -n "$LITESTREAM_REPLICA_BUCKET" ]; then
  echo "[startup] Database not found, attempting restore from R2..."
  litestream restore -config /app/litestream.yml -if-replica-exists /data/db.sqlite
  if [ -f /data/db.sqlite ]; then
    echo "[startup] Database restored from R2 backup"
  else
    echo "[startup] No replica found in R2 — starting with fresh database"
  fi
fi

# ── Pre-migration backup ─────────────────────────────────────────────────────
if [ -f /data/db.sqlite ]; then
  cp /data/db.sqlite /data/db.sqlite.pre-migrate-backup
  echo "[startup] Database backed up to /data/db.sqlite.pre-migrate-backup"
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
if [ -f /data/db.sqlite ]; then
  echo "[startup] Checking for failed migrations and recovering in one shot..."
  node -e '
    const Database = require("/app/node_modules/better-sqlite3");
    const db = new Database("/data/db.sqlite", { readonly: false });
    const cutoff = new Date(Date.now() - 120000).toISOString();
    try {
      const failed = db.prepare(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL AND started_at < ?"
      ).all(cutoff);
      if (failed.length > 0) {
        console.log(`[startup] WARNING: detected ${failed.length} failed migration(s) from a previous deploy`);
        console.log("[startup] Restoring database from pre-migration backup and marking as rolled back...");
        db.close();
        // Restore from backup first to get a clean schema state
        const fs = require("fs");
        if (fs.existsSync("/data/db.sqlite.pre-migrate-backup")) {
          fs.copyFileSync("/data/db.sqlite.pre-migrate-backup", "/data/db.sqlite");
          console.log("[startup] Database restored from pre-migrate backup");
        }
        // Mark failed migrations as rolled back so prisma migrate deploy retries them
        const db2 = new Database("/data/db.sqlite", { readonly: false });
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
./node_modules/.bin/prisma migrate deploy

# ── Post-migration verification ──────────────────────────────────────────────
# Defense-in-depth check: confirm the DB schema matches the migration files
# in the image. Catches cases where the image is stale or release_command was
# skipped. Non-fatal: we want the app to still serve, but log loudly so the
# operator notices. See src/lib/schemaCheck.server.ts for the library version
# exposed at GET /api/health/migration.
echo "[startup] Verifying schema is in sync with migrations directory..."
if ! ./node_modules/.bin/prisma migrate status >/tmp/migrate-status.log 2>&1; then
  echo "[startup] WARNING: schema drift detected after migrate deploy:"
  cat /tmp/migrate-status.log
  echo "[startup] App will start, but endpoints touching missing tables will fail."
fi

# ── Start app ─────────────────────────────────────────────────────────────────
if [ -n "$LITESTREAM_REPLICA_BUCKET" ]; then
  echo "[startup] Starting app with Litestream replication..."
  exec litestream replicate -exec "node dist/server/entry.mjs" -config /app/litestream.yml
else
  echo "[startup] Starting app (no Litestream — LITESTREAM_REPLICA_BUCKET not set)..."
  exec node dist/server/entry.mjs
fi
