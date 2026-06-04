#!/bin/sh
set -e

DATABASE_URL="${DATABASE_URL:-file:/data/db.sqlite}"
export DATABASE_URL

# Recover from failed migrations (same logic as start.sh, see comment there)
echo "[release] Checking for failed migrations..."
FAILED=$(node -e '
  const { PrismaClient } = require("/app/node_modules/@prisma/client");
  const p = new PrismaClient();
  p.$queryRawUnsafe(
    "SELECT migration_name, logs FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL AND started_at < (strftime(\"%s\", \"now\") - 300)"
  ).then(r => { console.log(JSON.stringify(r)); process.exit(0); }).catch(() => process.exit(0));
' 2>/dev/null || echo "[]")
if [ "$FAILED" != "[]" ] && [ -n "$FAILED" ]; then
  echo "[release] WARNING: detected failed migration(s) from a previous deploy: $FAILED"
  echo "$FAILED" | node -e '
    const { PrismaClient } = require("/app/node_modules/@prisma/client");
    const failed = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const p = new PrismaClient();
    (async () => {
      for (const m of failed) {
        try {
          await p.$executeRawUnsafe(
              "UPDATE _prisma_migrations SET finished_at = CURRENT_TIMESTAMP WHERE migration_name = ?",
            m.migration_name
           );
          console.log(`[release] Marked ${m.migration_name} as applied (recovery)`);
         } catch (e) {
          console.error(`[release] Failed to mark ${m.migration_name} as applied:`, e.message);
        }
      }
      process.exit(0);
    })();
  '
fi

echo "[release] Running prisma migrate deploy..."
node_modules/.bin/prisma migrate deploy
