#!/bin/sh
set -e

DATABASE_URL="${DATABASE_URL:-file:/data/db.sqlite}"
export DATABASE_URL

echo "[startup] Running database migrations..."

# Back up the database before migrating so we have a recovery path
if [ -f /data/db.sqlite ]; then
  cp /data/db.sqlite /data/db.sqlite.pre-migrate-backup
  echo "[startup] Database backed up to /data/db.sqlite.pre-migrate-backup"
fi

# Run migrations — if this fails, the deploy fails and Fly keeps the old machine.
# Do NOT auto-resolve failed migrations. They require manual intervention to
# understand why they failed before deciding how to fix them. The previous
# auto-resolve logic caused tables to never be created because it marked
# unexecuted migrations as "applied".
./node_modules/.bin/prisma migrate deploy

echo "[startup] Starting app..."
exec node dist/server/entry.mjs
