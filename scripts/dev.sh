#!/bin/sh
# Per-worktree dev launcher.
#
# Runs the Astro dev server with a worktree-specific port and SQLite database so
# several previews (main checkout + any number of git worktrees) can run at the
# same time without clobbering each other or sharing a database.
#
# Each preview gets:
#   - its own port (auto-allocated, cached in <worktree>/.dev-port)
#   - its own SQLite file (<worktree>/dev.db, created + migrated on first run)
#   - a matching BETTER_AUTH_URL, so cookies / OAuth callbacks work on that port
#
# Override any of them explicitly:
#   PORT=4400 DATABASE_URL=file:/tmp/x.db BETTER_AUTH_URL=http://localhost:4400 npm run dev
#
# Requires Node 24 (better-sqlite3 is built for that ABI). Set DEV_NODE to point
# at a specific node binary if the default one on PATH is incompatible.
set -e

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

port_free() {
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if [ -n "$PORT" ]; then
  DEV_PORT=$PORT
else
  if [ -f "$ROOT/.dev-port" ]; then
    DEV_PORT=$(cat "$ROOT/.dev-port" 2>/dev/null || echo "")
  fi
  case "$DEV_PORT" in
    ''|*[!0-9]*) DEV_PORT=$((4321 + ($(printf '%s' "$ROOT" | cksum | awk '{print $1}') % 200))) ;;
  esac
  while ! port_free "$DEV_PORT"; do
    DEV_PORT=$((DEV_PORT + 1))
  done
  printf '%s' "$DEV_PORT" > "$ROOT/.dev-port"
fi

export PORT=$DEV_PORT
export BETTER_AUTH_URL=${BETTER_AUTH_URL:-http://localhost:$DEV_PORT}
export DATABASE_URL=${DATABASE_URL:-file:$ROOT/dev.db}

DB_PATH=${DATABASE_URL#file:}
if [ ! -f "$DB_PATH" ]; then
  echo "▶ first run: creating $DB_PATH"
  node_modules/.bin/prisma migrate deploy
fi

NODE_BIN=${DEV_NODE:-}
if [ -z "$NODE_BIN" ]; then
  for candidate in /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node; do
    if [ -x "$candidate" ]; then NODE_BIN=$candidate; break; fi
  done
  NODE_BIN=${NODE_BIN:-node}
fi

echo "▶ dev  http://localhost:$DEV_PORT"
echo "  db   $DATABASE_URL"
echo "  node $NODE_BIN ($("$NODE_BIN" -v))"
exec "$NODE_BIN" --env-file=.env node_modules/astro/bin/astro.mjs dev --port "$DEV_PORT"
