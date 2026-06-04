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

echo "[startup] Running database migrations..."

# Run migrations — if this fails, the deploy fails and Fly keeps the old machine.
# Do NOT auto-resolve failed migrations. They require manual intervention to
# understand why they failed before deciding how to fix them. The previous
# auto-resolve logic caused tables to never be created because it marked
# unexecuted migrations as "applied".
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
