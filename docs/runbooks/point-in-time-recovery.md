# Runbook: Point-in-Time Recovery

Recover the production database to a specific moment in time using Litestream backups stored in Cloudflare R2.

**When to use**: accidental data deletion, bad migration, corrupted data, or any situation where you need to roll back to a known-good state.

## Prerequisites

- `flyctl` installed and authenticated (`fly auth login`)
- R2 access credentials (see `fly secrets list` for current values)
- `litestream` installed locally for optional preview (`brew install litestream` on macOS)
- `sqlite3` available (comes with macOS, `apk add sqlite` on Alpine)

## Important: 7-day retention window

Litestream is configured with `retention: 168h` (7 days). You can only restore to timestamps within the last 7 days. Anything older has been pruned from R2.

---

## Step 1: Identify the target timestamp

Determine the exact moment you want to restore to. Sources:

- Application logs: `fly logs`
- Event logs in the database (if still accessible)
- User reports with approximate times

The timestamp must be in RFC 3339 / ISO 8601 format: `YYYY-MM-DDTHH:MM:SSZ` (UTC).

Example: `2026-04-10T14:30:00Z`

## Step 2: List available snapshots

SSH into the Fly machine and check what's available:

```bash
fly ssh console -C "litestream snapshots -config /app/litestream.yml"
```

Expected output:

```
replica  generation        index  size     created
s3       xxxxxxxxxxxxxxxxx 0      4194304  2026-04-05T10:00:00Z
s3       xxxxxxxxxxxxxxxxx 1      4194304  2026-04-06T10:00:00Z
...
```

Verify your target timestamp falls within the range of available snapshots.

## Step 3 (Optional): Preview locally first

Before touching production, restore to your laptop and verify the data looks right.

Create a local config file `litestream-local.yml`:

```yaml
dbs:
  - path: ./restored.db
    replicas:
      - type: s3
        bucket: convocados
        endpoint: https://2ffa19ca2d5924a86dd7ea437f22e614.r2.cloudflarestorage.com
        region: auto
        force-path-style: true
        access-key-id: <your-r2-access-key>
        secret-access-key: <your-r2-secret-key>
```

Restore locally:

```bash
litestream restore -config litestream-local.yml -timestamp "2026-04-10T14:30:00Z" ./restored.db
```

Inspect with Prisma Studio:

```bash
DATABASE_URL="file:./restored.db" npx prisma studio
```

Or with sqlite3:

```bash
sqlite3 ./restored.db "SELECT count(*) FROM User;"
sqlite3 ./restored.db "SELECT count(*) FROM Event;"
sqlite3 ./restored.db "SELECT count(*) FROM Player;"
```

If the data looks correct, proceed to restore in production.

## Step 4: SSH into the Fly machine

```bash
fly ssh console
```

## Step 5: Stop the running app

Litestream is the parent process running the app via `-exec`. Killing the Node process will cause Litestream to exit too, but we want a clean stop:

```bash
# Kill the Node app process
kill $(pgrep -f "node dist/server/entry.mjs")
# Kill Litestream (stops replication)
kill $(pgrep -x litestream)
```

Wait a moment for processes to exit:

```bash
sleep 2
pgrep -x litestream || echo "Litestream stopped"
pgrep -f "node dist" || echo "App stopped"
```

## Step 6: Back up the current database

Always keep a copy of the current state before overwriting:

```bash
cp /data/db.sqlite /data/db.sqlite.pre-restore-backup
echo "Current DB backed up to /data/db.sqlite.pre-restore-backup"
```

## Step 7: Remove current database files

You must remove the WAL and SHM files too, otherwise SQLite may replay them on top of the restored data:

```bash
rm -f /data/db.sqlite /data/db.sqlite-wal /data/db.sqlite-shm
```

## Step 8: Restore to the target timestamp

```bash
litestream restore -config /app/litestream.yml -timestamp "2026-04-10T14:30:00Z" /data/db.sqlite
```

Expected output:

```
/data/db.sqlite: restoring snapshot XXXXXXXXXXXXXXXX/XXXXXXXXXXXXXXXX to /data/db.sqlite
```

## Step 9: Verify database integrity

```bash
sqlite3 /data/db.sqlite "PRAGMA integrity_check;"
```

Expected output: `ok`

Spot-check key tables:

```bash
sqlite3 /data/db.sqlite "SELECT count(*) FROM User;"
sqlite3 /data/db.sqlite "SELECT count(*) FROM Event;"
sqlite3 /data/db.sqlite "SELECT count(*) FROM Player;"
sqlite3 /data/db.sqlite "SELECT count(*) FROM GameHistory;"
```

Compare these counts against what you expect for the target timestamp.

## Step 10: Restart the machine

Exit the SSH session and restart:

```bash
exit
fly machines restart
```

The startup script (`scripts/start.sh`) will:
1. Skip the restore step (DB file now exists)
2. Run Prisma migrations (applies any schema changes newer than the restored snapshot)
3. Start the app with Litestream replication

## Step 11: Verify health

```bash
curl -s https://convocados.fly.dev/api/health | jq .
```

Expected output:

```json
{
  "status": "ok",
  "db": {
    "journalMode": "wal",
    "writable": true
  },
  "litestream": {
    "running": true
  }
}
```

Check logs to confirm replication resumed:

```bash
fly logs | grep litestream
```

---

## Troubleshooting

### "no matching backups found" or empty snapshot list

Your target timestamp is outside the 7-day retention window, or no backups exist yet. Check:

```bash
fly ssh console -C "litestream snapshots -config /app/litestream.yml"
```

If the list is empty, Litestream was never replicating. Check that `LITESTREAM_REPLICA_BUCKET` and other secrets are set:

```bash
fly secrets list
```

### PRAGMA integrity_check fails

The restored database is corrupted. Try restoring to a slightly earlier timestamp:

```bash
rm -f /data/db.sqlite /data/db.sqlite-wal /data/db.sqlite-shm
litestream restore -config /app/litestream.yml -timestamp "2026-04-10T14:00:00Z" /data/db.sqlite
sqlite3 /data/db.sqlite "PRAGMA integrity_check;"
```

If all snapshots are corrupted, see the [Full Recovery from Zero](./full-recovery-from-zero.md) runbook.

### Prisma migration fails after restore

The restored DB may be behind on schema. If `prisma migrate deploy` fails:

1. Check which migrations are pending: `./node_modules/.bin/prisma migrate status`
2. If the failure is due to a column/table already existing (from a partial migration), you may need to manually resolve — see the Prisma docs on [failed migrations](https://www.prisma.io/docs/guides/database/production-troubleshooting)
3. Do NOT use `prisma migrate resolve --applied` unless you're certain the migration was fully applied

### App won't start after restore

Check logs:

```bash
fly logs
```

Common causes:
- Migration failure (see above)
- Database file permissions: `chmod 644 /data/db.sqlite`
- Volume not mounted: `fly ssh console -C "ls -la /data/"`

### litestream.running is false after restart

Litestream may have failed to start. Check:

```bash
fly logs | grep -i "litestream\|replicate\|error"
```

Verify secrets are set:

```bash
fly secrets list | grep LITESTREAM
```

If secrets are missing, set them and redeploy:

```bash
fly secrets set \
  LITESTREAM_REPLICA_BUCKET=convocados \
  LITESTREAM_REPLICA_ENDPOINT=https://2ffa19ca2d5924a86dd7ea437f22e614.r2.cloudflarestorage.com \
  LITESTREAM_REPLICA_REGION=auto \
  LITESTREAM_ACCESS_KEY_ID=<r2-access-key-id> \
  LITESTREAM_SECRET_ACCESS_KEY=<r2-secret-access-key>
```
