#!/bin/sh
# Read-only query against the production SQLite database, over Fly SSH.
#
# Why this exists: the production image has no `sqlite3` CLI (`executable file
# not found`), but it ships the same `better-sqlite3` the app bundles. This
# wrapper runs a read-only query through Node, so inspecting production never
# means improvising a base64 Node incantation or downloading a PII snapshot.
#
# Read-only is enforced twice: a local leading-keyword guard rejects a write
# before any SSH connection opens, and the remote connection is opened in
# readonly mode (SQLite rejects any write regardless of the statement).
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

# Refuse a write locally, before opening any SSH session. Kept testable without
# a live Fly app (the guardrail suite spawns this with a stub `fly`).
head_kw=$(printf '%s' "$SQL" | sed 's/^[[:space:]]*//' | cut -d' ' -f1 | tr 'A-Z' 'a-z')
case "$head_kw" in
  select|pragma|with) ;;
  *)
    echo "read-only: only SELECT / PRAGMA / WITH are allowed (got '$head_kw')" >&2
    exit 2
    ;;
esac

# The query and the remote harness both travel base64-encoded. That matters:
# the harness crosses an SSH boundary and a remote shell, and an earlier version
# that relied on shell-escaping a regex silently lost a backslash (`\s` became
# `s`), so every query was rejected. Base64 removes every quoting failure mode.
SQL_B64=$(printf '%s' "$SQL" | base64 | tr -d '\n')

HARNESS="const mod=process.env.PROD_SQLITE_MODULE||'/app/node_modules/better-sqlite3';
const dbPath=process.env.PROD_DB_PATH||'/data/db.sqlite';
const D=require(mod);
const sql=Buffer.from('$SQL_B64','base64').toString();
const head=(sql.trim().match(/[A-Za-z]+/)||[''])[0].toLowerCase();
if(!['select','pragma','with'].includes(head)){console.error('read-only: only SELECT / PRAGMA / WITH are allowed');process.exit(2);}
const db=new D(dbPath,{readonly:true,fileMustExist:true});
console.log(JSON.stringify(db.prepare(sql).all(),null,1));
"
HARNESS_B64=$(printf '%s' "$HARNESS" | base64 | tr -d '\n')

exec fly ssh console -a "$APP" -C "node -e \"eval(Buffer.from('$HARNESS_B64','base64').toString())\""
