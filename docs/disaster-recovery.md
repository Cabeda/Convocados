# Disaster Recovery Guide

This document covers how Convocados backs up and restores its SQLite database using [Litestream](https://litestream.io/) and Cloudflare R2.

## Architecture

- **Database**: SQLite in WAL mode at `/data/db.sqlite` (Fly.io persistent volume)
- **Replication**: Litestream continuously streams WAL changes to Cloudflare R2
- **Config**: `/app/litestream.yml`
- **Startup**: `scripts/start.sh` handles restore-on-boot + replicate-on-run

## Automatic Recovery (on boot)

The startup script (`scripts/start.sh`) handles recovery automatically:

1. Checks if `/data/db.sqlite` exists
2. If missing, runs `litestream restore -if-replica-exists` to pull the latest snapshot from R2
3. Runs Prisma migrations to apply any pending schema changes
4. Starts the app with Litestream replicating in the background

This means a destroyed or fresh Fly machine will self-heal on first boot.

If the restore exits non-zero — no permission (`NotEntitled`), a network error, or a
bucket problem — the script prints Litestream's last lines and **continues with a
fresh database** so the app still boots. That is a data-loss state: migrations
recreate the schema, but the previous data is gone until the replica is reachable.
Fix the cause before treating the instance as recovered.

Before migrations, the script checkpoints the WAL
(`PRAGMA wal_checkpoint(TRUNCATE)`) and copies the database to
`db.sqlite.pre-migrate-backup`. If the checkpoint cannot run it preserves the
`-wal`/`-shm` sidecars with the backup. The failed-migration recovery removes the
live sidecars before restoring the backup, so newer frames cannot replay over the
restored file.

### Disabling backups explicitly

When R2 itself is known to be unavailable (for example the account-level
`NotEntitled` outage in #1487), set:

```toml
# fly.toml [env]
BACKUPS_ENABLED = "false"
```

The app then boots without attempting a restore or running a replica that cannot
succeed. `/api/health` reports `litestream: { enabled: false, ... }` and does not
mark the service degraded for it; the local pre-migration backup still runs. This
is a data-loss posture — there is no off-host copy — so make it an explicit,
reviewed decision, not a default.

To re-enable: set `BACKUPS_ENABLED = "true"` (or remove the line), confirm the
`LITESTREAM_*` secrets are present and R2 is entitled, then deploy. Health should
return `litestream.enabled: true` with a fresh `lastSyncAt`.

## Manual Recovery

### SSH into the Fly machine

```bash
fly ssh console
```

### Stop the app (if running)

```bash
kill $(pgrep -f "node dist/server/entry.mjs")
```

### Restore latest backup

```bash
litestream restore -config /app/litestream.yml /data/db.sqlite
```

### Restore to a specific point in time

```bash
litestream restore -config /app/litestream.yml -timestamp "2026-03-20T12:00:00Z" /data/db.sqlite
```

### Verify the restored database

The image has no `sqlite3` CLI (`executable file not found`). Query the restored
file with the bundled `better-sqlite3`:

```bash
node -e "const D=require('/app/node_modules/better-sqlite3');const db=new D('/data/db.sqlite',{readonly:true});console.log('integrity',db.pragma('integrity_check'));console.log('events',db.prepare('SELECT count(*) c FROM Event').get().c);"
```

For live reads of the running database from your machine, use
[`scripts/prod-query.sh`](../scripts/prod-query.sh) — see
[runbooks/production-inspection.md](runbooks/production-inspection.md).

### Restart the machine

```bash
fly machines restart
```

## Local Recovery (download backup)

### 1. Install Litestream

```bash
brew install litestream  # macOS
```

### 2. Create a local config (`litestream-local.yml`)

```yaml
dbs:
  - path: ./restored.db
    replica:
      type: s3
      bucket: convocados
      endpoint: https://2ffa19ca2d5924a86dd7ea437f22e614.r2.cloudflarestorage.com
      region: auto
      force-path-style: true
      access-key-id: <your-r2-access-key>
      secret-access-key: <your-r2-secret-key>
```

### 3. Restore

```bash
litestream restore -config litestream-local.yml ./restored.db
```

### 4. Inspect with Prisma Studio

```bash
DATABASE_URL="file:./restored.db" npx prisma studio
```

## Listing Available Snapshots

```bash
fly ssh console -C "litestream snapshots -config /app/litestream.yml"
```

## Monitoring

- Check replication is active: `fly logs | grep litestream`
- Health endpoint reports WAL mode and Litestream status: `curl https://convocados.fly.dev/api/health`

## Fly.io Secrets Reference

The following secrets must be set for Litestream to work:

| Secret | Value |
|--------|-------|
| `LITESTREAM_REPLICA_BUCKET` | `convocados` |
| `LITESTREAM_REPLICA_ENDPOINT` | `https://2ffa19ca2d5924a86dd7ea437f22e614.r2.cloudflarestorage.com` |
| `LITESTREAM_REPLICA_REGION` | `auto` |
| `LITESTREAM_ACCESS_KEY_ID` | R2 API token access key |
| `LITESTREAM_SECRET_ACCESS_KEY` | R2 API token secret key |

To set them:

```bash
fly secrets set \
  LITESTREAM_REPLICA_BUCKET=convocados \
  LITESTREAM_REPLICA_ENDPOINT=https://2ffa19ca2d5924a86dd7ea437f22e614.r2.cloudflarestorage.com \
  LITESTREAM_REPLICA_REGION=auto \
  LITESTREAM_ACCESS_KEY_ID=<r2-access-key-id> \
  LITESTREAM_SECRET_ACCESS_KEY=<r2-secret-access-key>
```

## Setup Checklist

- [ ] R2 API token created in Cloudflare dashboard (read/write access to `convocados` bucket)
- [ ] Fly.io secrets set (see table above)
- [ ] `fly deploy` succeeds
- [ ] Logs show `Starting app with Litestream replication...`
- [ ] `fly ssh console -C "litestream snapshots -config /app/litestream.yml"` shows snapshots
- [ ] Destroy and recreate machine — DB restores automatically from R2
- [ ] Health endpoint returns `journalMode: "wal"`
