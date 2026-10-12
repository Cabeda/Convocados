#!/bin/sh
# Read-only query against the production SQLite database, over Fly SSH.
#
# Why this exists: the production image has no `sqlite3` CLI (`executable file
# not found`), but it ships the same `better-sqlite3` the app bundles. This
# wrapper runs a read-only query through Node, so inspecting production never
# means improvising a base64 Node incantation or downloading a PII snapshot.
#
# Read-only is enforced twice: the connection opens in readonly mode (SQLite
# rejects any write regardless of the statement), and a leading-keyword guard
# rejects anything that is not SELECT/PRAGMA/WITH before it reaches the DB.
#
# Usage:
#   scripts/prod-query.sh "SELECT type, count(*) c FROM ScheduledJob GROUP BY type"
#   scripts/prod-query.sh "SELECT id,type,lastError FROM ScheduledJob WHERE failedAt IS NOT NULL"
#
# Override the app with PROD_APP=<fly-app> (the database lives in the web app,
# not the scheduler worker). Requires flyctl, authenticated.
set -e

APP="${PROD_APP:-convocados}"
SQL="$1"

if [ -z "$SQL" ]; then
  echo "usage: $0 \"<SELECT ...>\"" >&2
  echo "  (override the Fly app with PROD_APP=<app>; default: convocados)" >&2
  exit 2
fi

# Refuse a write locally, before opening any SSH session. The remote guard below
# repeats this (defence in depth against a modified script), but failing here
# keeps the read-only contract testable without a live Fly app.
head_kw=$(printf '%s' "$SQL" | sed 's/^[[:space:]]*//' | cut -d' ' -f1 | tr 'A-Z' 'a-z')
case "$head_kw" in
  select|pragma|with) ;;
  *)
    echo "read-only: only SELECT / PRAGMA / WITH are allowed (got '$head_kw')" >&2
    exit 2
    ;;
esac

# The query crosses an SSH boundary, a remote shell and a JS string literal.
# Base64-encoding it removes every quoting failure mode at once.
B64=$(printf '%s' "$SQL" | base64 | tr -d '\n')

exec fly ssh console -a "$APP" -C "node -e \"
const D = require('/app/node_modules/better-sqlite3');
const sql = Buffer.from('$B64', 'base64').toString();
const head = sql.trim().split(/\\s+/, 1)[0].toLowerCase();
if (!['select', 'pragma', 'with'].includes(head)) {
  console.error('read-only: only SELECT / PRAGMA / WITH are allowed');
  process.exit(2);
}
const db = new D('/data/db.sqlite', { readonly: true, fileMustExist: true });
console.log(JSON.stringify(db.prepare(sql).all(), null, 1));
\""
