#!/bin/sh
# Run a command with the repo's .env loaded — the caller's own variables win.
#
# ./.env holds the developer's defaults (DATABASE_URL points at their local
# dev.db). A caller that names a different DATABASE_URL means it, and the old
# sourcing order quietly overrode it: the seed then ran against a database
# whose schema was behind the migrations and failed on a column that did not
# exist. This keeps the caller's value.
#
# Usage: sh scripts/with-env.sh <command> [args...]
#
# `set -u` is deliberately not used: a developer's .env may reference a
# variable that is not set, and sourcing it under `-u` aborts the command.
set -e

caller_database_url="${DATABASE_URL-}"

if [ -f ./.env ]; then
  set -a
  . ./.env
  set +a
fi

if [ -n "$caller_database_url" ]; then
  DATABASE_URL="$caller_database_url"
  export DATABASE_URL
fi

# pnpm's own resolution has bitten the seed before ("pnpm + tsx resolution"),
# so the bin directory is put on the path explicitly.
PATH="$PWD/node_modules/.pnpm/node_modules/.bin:$PATH"
export PATH

exec "$@"
