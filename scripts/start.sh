#!/bin/sh
set -e

DATABASE_URL="${DATABASE_URL:-file:/data/db.sqlite}"
export DATABASE_URL

echo "[startup] Running database migrations..."

# Check for failed migrations and resolve them before deploying
MIGRATE_STATUS=$(./node_modules/.bin/prisma migrate status 2>&1) || true
echo "[startup] migrate status:"
echo "$MIGRATE_STATUS"

# Only resolve migrations that are explicitly marked as "Failed" in the status output.
# The previous approach extracted ALL migration names and marked them all as applied
# when any single migration failed — this caused tables to never be created.
# Now we only extract migration names from lines that contain "Failed".
FAILED_MIGRATIONS=$(echo "$MIGRATE_STATUS" | grep -i "failed" | grep -oE '[0-9]{14}_[a-zA-Z0-9_]+' | sort -u)

if [ -n "$FAILED_MIGRATIONS" ]; then
  for MIGRATION in $FAILED_MIGRATIONS; do
    echo "[startup] WARNING: Marking failed migration as rolled-back: $MIGRATION"
    echo "[startup] This migration will need to be re-applied or manually fixed."
    ./node_modules/.bin/prisma migrate resolve --rolled-back "$MIGRATION" 2>&1 || true
  done
fi

# Now deploy migrations
./node_modules/.bin/prisma migrate deploy

echo "[startup] Starting app..."
exec node dist/server/entry.mjs
