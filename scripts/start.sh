#!/bin/sh
set -e

DATABASE_URL="${DATABASE_URL:-file:/data/db.sqlite}"
export DATABASE_URL

echo "[startup] Running database migrations..."

# Check for failed migrations and resolve them before deploying
MIGRATE_STATUS=$(./node_modules/.bin/prisma migrate status 2>&1) || true
echo "[startup] migrate status:"
echo "$MIGRATE_STATUS"

# Extract failed migration names (lines matching the timestamp_name pattern)
FAILED_MIGRATIONS=$(echo "$MIGRATE_STATUS" | grep -oE '[0-9]{14}_[a-zA-Z0-9_]+' | sort -u)

if [ -n "$FAILED_MIGRATIONS" ] && echo "$MIGRATE_STATUS" | grep -qi "failed"; then
  for MIGRATION in $FAILED_MIGRATIONS; do
    echo "[startup] Marking failed migration as applied: $MIGRATION"
    ./node_modules/.bin/prisma migrate resolve --applied "$MIGRATION" 2>&1 || true
  done
fi

# Now deploy migrations
./node_modules/.bin/prisma migrate deploy

echo "[startup] Starting app..."
exec node dist/server/entry.mjs
