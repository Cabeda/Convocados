#!/bin/sh
# Run a command with the repo's .env loaded.
#
# ./.env holds the developer's defaults (DATABASE_URL points at their local
# dev.db). A caller that names a different DATABASE_URL means it, and the old
# sourcing order quietly overrode it: the seed then ran against a database
# whose schema was behind the migrations and failed on a column that did not
# exist. Every other variable keeps the .env value — the auth secret and the
# VAPID keys are the developer's, and a caller's shell rarely has them.
#
# Usage: sh scripts/with-env.sh <command> [args...]
#
# `set -e` is deliberately not in force while .env is sourced: a developer's
# .env may run a command that fails (a missing tool, a substitution that
# errors), and sourcing it under `-e` aborts the command the caller asked for.
# `set -u` is not in force either — an unset variable in a .env line does the
# same.
set -e

caller_database_url="${DATABASE_URL-}"

if [ -f ./.env ]; then
  set +e
  set -a
  . ./.env
  set +a
  set -e
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
