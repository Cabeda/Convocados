# Runbook: Full Recovery from Zero

Recover the production database from total data loss using Litestream backups stored in Cloudflare R2.

**When to use**: the Fly machine was destroyed, the persistent volume was wiped, or you're provisioning a completely new environment and need to restore all data from backups.

## Prerequisites

- `flyctl` installed and authenticated (`fly auth login`)
- R2 access credentials (access key ID + secret key for the `convocados` bucket)
- `litestream` installed locally for verification (`brew install litestream` on macOS)
- `sqlite3` available (comes with macOS)

## Important: 7-day retention window

Litestream is configured with `retention: 168h` (7 days). If the last replication happened more than 7 days ago, the backups may have been pruned. Act quickly when you discover data loss.

---

## Step 1: Verify R2 has backup data

Before doing anything on Fly, confirm that R2 actually contains snapshots. Run this from your local machine.

Create a local config file `litestream-local.yml` (if you don't already have one):

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

List available snapshots:

```bash
litestream snapshots -config litestream-local.yml
```

Expected output:

```
replica  generation        index  size     created
s3       xxxxxxxxxxxxxxxxx 0      4194304  2026-04-05T10:00:00Z
s3       xxxxxxxxxxxxxxxxx 1      4194304  2026-04-06T10:00:00Z
...
```

If the list is empty, there are no backups to restore from. Stop here and assess other recovery options.

## Step 2: (Optional) Restore locally to verify data

Before restoring to production, pull the latest backup to your laptop and verify it:

```bash
litestream restore -config litestream-local.yml ./restored.db
```

Check integrity and row counts:

```bash
sqlite3 ./restored.db "PRAGMA integrity_check;"
sqlite3 ./restored.db "SELECT count(*) FROM User;"
sqlite3 ./restored.db "SELECT count(*) FROM Event;"
sqlite3 ./restored.db "SELECT count(*) FROM Player;"
```

Optionally inspect with Prisma Studio:

```bash
DATABASE_URL="file:./restored.db" npx prisma studio
```

## Step 3: Verify Fly secrets are set

The Litestream config uses environment variables for R2 credentials. Confirm they're set:

```bash
fly secrets list
```

You should see:

```
NAME                          DIGEST                  CREATED AT
LITESTREAM_ACCESS_KEY_ID      xxxxxxxxxxxxxxxxxxxxxx  ...
LITESTREAM_REPLICA_BUCKET     xxxxxxxxxxxxxxxxxxxxxx  ...
LITESTREAM_REPLICA_ENDPOINT   xxxxxxxxxxxxxxxxxxxxxx  ...
LITESTREAM_REPLICA_REGION     xxxxxxxxxxxxxxxxxxxxxx  ...
LITESTREAM_SECRET_ACCESS_KEY  xxxxxxxxxxxxxxxxxxxxxx  ...
```

If any are missing, set them:

```bash
fly secrets set \
  LITESTREAM_REPLICA_BUCKET=convocados \
  LITESTREAM_REPLICA_ENDPOINT=https://2ffa19ca2d5924a86dd7ea437f22e614.r2.cloudflarestorage.com \
  LITESTREAM_REPLICA_REGION=auto \
  LITESTREAM_ACCESS_KEY_ID=<r2-access-key-id> \
  LITESTREAM_SECRET_ACCESS_KEY=<r2-secret-access-key>
```

## Step 4: Ensure a persistent volume exists

The database lives on a Fly persistent volume mounted at `/data`. Check if one exists:

```bash
fly volumes list
```

If the volume was destroyed, create a new one in the same region (`cdg`):

```bash
fly volumes create football_data --region cdg --size 1
```

Expected output:

```
ID: vol_xxxxxxxxxxxxxx
Name: football_data
Region: cdg
Size: 1GB
Created at: ...
```

## Step 5: Deploy

Deploy the app. The startup script (`scripts/start.sh`) will automatically:

1. Detect that `/data/db.sqlite` doesn't exist
2. Run `litestream restore -if-replica-exists` to pull the latest backup from R2
3. Run Prisma migrations
4. Start the app with Litestream replication

```bash
fly deploy
```

Watch the logs to confirm the restore happened:

```bash
fly logs
```

You should see:

```
[startup] Database not found, attempting restore from R2...
[startup] Database restored from R2 backup
[startup] Database backed up to /data/db.sqlite.pre-migrate-backup
[startup] Running database migrations...
[startup] Starting app with Litestream replication...
```

## Step 6: Verify health

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

## Step 7: Verify data integrity

SSH into the machine and spot-check:

```bash
fly ssh console -C "sqlite3 /data/db.sqlite 'PRAGMA integrity_check;'"
fly ssh console -C "sqlite3 /data/db.sqlite 'SELECT count(*) FROM User;'"
fly ssh console -C "sqlite3 /data/db.sqlite 'SELECT count(*) FROM Event;'"
fly ssh console -C "sqlite3 /data/db.sqlite 'SELECT count(*) FROM Player;'"
```

Compare these counts against what you saw in the local preview (Step 2).

## Step 8: Confirm replication is active

Verify Litestream is streaming WAL changes to R2:

```bash
fly logs | grep litestream
```

You should see periodic replication messages. Also verify via the health endpoint that `litestream.running` is `true` (Step 6).

---

## If auto-restore fails

If the deploy succeeds but the database wasn't restored (e.g., logs show "No replica found in R2"), restore manually:

### SSH into the machine

```bash
fly ssh console
```

### Stop the app

```bash
kill $(pgrep -f "node dist/server/entry.mjs")
kill $(pgrep -x litestream)
sleep 2
```

### Manually restore

```bash
litestream restore -config /app/litestream.yml /data/db.sqlite
```

### Verify

```bash
sqlite3 /data/db.sqlite "PRAGMA integrity_check;"
```

### Restart

```bash
exit
fly machines restart
```

---

## Nuclear option: machine completely gone

If the Fly app has no machines at all:

```bash
# Check current state
fly status

# If no machines exist, deploy will create one
fly deploy

# If deploy fails because there's no machine to deploy to:
fly machine create . --region cdg
fly deploy
```

The new machine will mount the volume (or a new one if you created it in Step 4), and the startup script will restore from R2.

---

## Troubleshooting

### "no matching backups found" when restoring

R2 bucket is empty or credentials are wrong. Verify:

```bash
# Check secrets
fly secrets list | grep LITESTREAM

# Test locally with your credentials
litestream snapshots -config litestream-local.yml
```

If snapshots exist locally but not on the Fly machine, the secrets on Fly are likely wrong or missing. Re-set them (Step 3).

### R2 credentials expired or revoked

Create a new R2 API token in the Cloudflare dashboard:

1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Create a token with read/write access to the `convocados` bucket
3. Update Fly secrets with the new credentials

### Volume not mounted

If the app starts but can't write to `/data`:

```bash
fly ssh console -C "ls -la /data/"
```

If `/data` doesn't exist or is empty, the volume isn't mounted. Check:

```bash
fly volumes list
```

Ensure the volume name matches `football_data` (as configured in `fly.toml`).

### Prisma migration fails on restored database

The restored DB may be from before a migration was created. If `prisma migrate deploy` fails:

1. Check migration status: `fly ssh console -C "./node_modules/.bin/prisma migrate status"`
2. If a migration partially applied, you may need manual intervention
3. See the [Point-in-Time Recovery](./point-in-time-recovery.md) runbook's troubleshooting section for migration-specific guidance

### App starts but returns 503

The database may not have been restored. Check:

```bash
fly ssh console -C "ls -la /data/db.sqlite"
fly ssh console -C "sqlite3 /data/db.sqlite 'PRAGMA integrity_check;'"
```

If the file doesn't exist, the restore failed silently. Run the manual restore steps above.

### Health endpoint shows litestream.running: false

Litestream process isn't running. Check logs:

```bash
fly logs | grep -i "litestream\|replicate\|error"
```

Common causes:
- Missing `LITESTREAM_REPLICA_BUCKET` secret (Litestream is skipped entirely)
- R2 credentials invalid (Litestream crashes on startup)
- Litestream binary not found (Docker image issue — redeploy)
