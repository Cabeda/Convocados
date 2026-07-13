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
if [ -f /data/db.sqlite ]; then
  echo "[startup] Checking for failed migrations and recovering in one shot..."
  node -e '
    const { PrismaClient } = require("/app/node_modules/@prisma/client");
    const p = new PrismaClient();
    (async () => {
      try {
        const failed = await p.$queryRawUnsafe(
          "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL AND started_at < (strftime(\"%s\", \"now\") - 120)"
        );
        if (failed.length > 0) {
          console.log(`[startup] WARNING: detected ${failed.length} failed migration(s) from a previous deploy`);
          console.log("[startup] Restoring database from pre-migration backup and marking as rolled back...");
          await p.$disconnect();
          // Restore from backup first to get a clean schema state
          const fs = require("fs");
          if (fs.existsSync("/data/db.sqlite.pre-migrate-backup")) {
            fs.copyFileSync("/data/db.sqlite.pre-migrate-backup", "/data/db.sqlite");
            console.log("[startup] Database restored from pre-migrate backup");
          }
          // Mark failed migrations as rolled back so prisma migrate deploy retries them
          const p2 = new PrismaClient();
          for (const m of failed) {
            try {
              await p2.$executeRawUnsafe(
                "UPDATE _prisma_migrations SET rolled_back_at = CURRENT_TIMESTAMP WHERE migration_name = ? AND finished_at IS NULL",
                m.migration_name
              );
              console.log(`[startup] Marked ${m.migration_name} as rolled back`);
            } catch (e) {
              console.error(`[startup] Failed to mark ${m.migration_name} as rolled back:`, e.message);
            }
          }
          await p2.$disconnect();
        } else {
          console.log("[startup] No failed migrations detected.");
        }
      } catch (e) {
        console.error("[startup] Failed-migration check failed (non-fatal):", e.message);
      }
      await p.$disconnect();
    })();
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
