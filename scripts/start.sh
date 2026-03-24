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

# Resolve any previously failed migrations so deploy can proceed
FAILED=$(./node_modules/.bin/prisma migrate status 2>&1 | grep -oE 'The `[^`]+` migration' | head -1 | sed 's/The `\(.*\)` migration/\1/' || true)
if [ -n "$FAILED" ]; then
  echo "[startup] Found failed migration: $FAILED — marking as rolled back and re-applying..."
  ./node_modules/.bin/prisma migrate resolve --rolled-back "$FAILED"
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
