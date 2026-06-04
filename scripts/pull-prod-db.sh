#!/bin/sh
# Pull the production SQLite database from the Fly.io volume to the local
# machine for debugging. The downloaded files land in prisma/prod-debug.db
# (which is covered by the .gitignore *.db rule).
#
# Usage:
#   npm run db:pull-prod
#   # or with a custom app name:
#   FLY_APP=convocados-staging npm run db:pull-prod
#
# Requirements:
#   - fly CLI authenticated against the target org
#   - sqlite3 on PATH (used for integrity check + row counts)
set -eu

FLY_APP="${FLY_APP:-convocados}"
REMOTE_DIR="/data"
LOCAL_DIR="prisma"
DB_NAME="prod-debug.db"

DB_PATH="$LOCAL_DIR/$DB_NAME"
WAL_PATH="$LOCAL_DIR/$DB_NAME-wal"
SHM_PATH="$LOCAL_DIR/$DB_NAME-shm"

if ! command -v fly >/dev/null 2>&1; then
  echo "error: 'fly' CLI not found. Install: https://fly.io/docs/hands-on/install-flyctl/" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "error: 'sqlite3' not found. Install with: brew install sqlite" >&2
  exit 1
fi

echo "==> Pulling $DB_NAME from $FLY_APP:$REMOTE_DIR"

mkdir -p "$LOCAL_DIR"
rm -f "$DB_PATH" "$WAL_PATH" "$SHM_PATH"

for suffix in "" "-wal" "-shm"; do
  remote="$REMOTE_DIR/db.sqlite$suffix"
  local="$DB_PATH$suffix"
  echo "    $remote -> $local"
  fly ssh sftp get "$remote" "$local"
done

echo "==> Verifying integrity"
integrity=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;")
if [ "$integrity" != "ok" ]; then
  echo "error: integrity_check failed: $integrity" >&2
  exit 1
fi

echo "    ok"

echo "==> Snapshot"
sqlite3 -header -column "$DB_PATH" "
  SELECT 'users'    AS table_name, (SELECT count(*) FROM User)         AS rows UNION ALL
  SELECT 'events',                  (SELECT count(*) FROM Event)        UNION ALL
  SELECT 'players',                 (SELECT count(*) FROM Player)       UNION ALL
  SELECT 'game_history',            (SELECT count(*) FROM GameHistory)  UNION ALL
  SELECT 'event_invites',           (SELECT count(*) FROM EventInvite)  UNION ALL
  SELECT 'scheduled_jobs',          (SELECT count(*) FROM ScheduledJob) UNION ALL
  SELECT 'push_subscriptions',      (SELECT count(*) FROM PushSubscription);
"

echo
echo "Done. DB at: $DB_PATH"
echo "Serve locally with: npm run dev:prod-db"
