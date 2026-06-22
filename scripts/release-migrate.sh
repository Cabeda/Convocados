#!/bin/sh
set -e

DATABASE_URL="${DATABASE_URL:-file:/data/db.sqlite}"
export DATABASE_URL

# Single Node.js process: detect failed migrations, mark them applied, then exit.
# This replaces the previous two-process check+recover flow (saves one Node.js
# cold start — ~5-10s on Fly's shared-cpu machines). See start.sh for the
# comment on why we auto-resolve: the alternative is the app being permanently
# down after a failed migration.
echo "[release] Checking for failed migrations and recovering in one shot..."
node -e '
  const { PrismaClient } = require("/app/node_modules/@prisma/client");
  const p = new PrismaClient();
  (async () => {
    try {
      const failed = await p.$queryRawUnsafe(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL AND started_at < (strftime(\"%s\", \"now\") - 300)"
      );
      if (failed.length > 0) {
        console.log(`[release] WARNING: detected ${failed.length} failed migration(s) from a previous deploy`);
        for (const m of failed) {
          await p.$executeRawUnsafe(
            "UPDATE _prisma_migrations SET finished_at = CURRENT_TIMESTAMP WHERE migration_name = ?",
            m.migration_name
          );
          console.log(`[release] Marked ${m.migration_name} as applied (recovery)`);
        }
      } else {
        console.log("[release] No failed migrations detected.");
      }
    } catch (e) {
      console.error("[release] Failed-migration check failed (non-fatal):", e.message);
    }
    await p.$disconnect();
  })();
'

echo "[release] Running prisma migrate deploy..."
node_modules/.bin/prisma migrate deploy
