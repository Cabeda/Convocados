#!/bin/sh
set -e

DB_PATH="/data/db.sqlite"

# ── Restore from Litestream replica if DB doesn't exist ──────────────────────
if [ -f /usr/local/bin/litestream ] && [ -n "$LITESTREAM_REPLICA_BUCKET" ]; then
  if [ ! -f "$DB_PATH" ]; then
    echo "[startup] No local database found. Restoring from Litestream replica..."
    litestream restore -if-replica-exists -config /app/litestream.yml "$DB_PATH"
    if [ -f "$DB_PATH" ]; then
      echo "[startup] Database restored successfully."
    else
      echo "[startup] No replica found. A fresh database will be created."
    fi
  fi
fi

# ── Run Prisma migrations ────────────────────────────────────────────────────
echo "[startup] Running database migrations..."

# Resolve any previously failed migrations so deploy can proceed.
# Temporarily disable set -e since prisma migrate status exits non-zero on failures.
set +e
MIGRATE_STATUS=$(./node_modules/.bin/prisma migrate status 2>&1)
MIGRATE_EXIT=$?
set -e

echo "[startup] migrate status (exit $MIGRATE_EXIT):"
echo "$MIGRATE_STATUS"

if echo "$MIGRATE_STATUS" | grep -q "failed"; then
  FAILED_NAME=$(echo "$MIGRATE_STATUS" | sed -n 's/.*`\([^`]*\)` migration.*/\1/p' | head -1)
  if [ -n "$FAILED_NAME" ]; then
    echo "[startup] Resolving failed migration: $FAILED_NAME"
    set +e
    ./node_modules/.bin/prisma migrate resolve --rolled-back "$FAILED_NAME"
    set -e
  else
    echo "[startup] WARNING: detected failed migration but could not extract name"
  fi
fi

./node_modules/.bin/prisma migrate deploy

# ── Start the app (with or without Litestream) ───────────────────────────────
if [ -f /usr/local/bin/litestream ] && [ -n "$LITESTREAM_REPLICA_BUCKET" ]; then
  echo "[startup] Starting app with Litestream replication..."
  exec litestream replicate -config /app/litestream.yml -exec "node dist/server/entry.mjs"
else
  echo "[startup] Starting app without Litestream (no replica config)..."
  exec node dist/server/entry.mjs
fi
