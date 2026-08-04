#!/bin/sh
set -e

DATABASE_URL="${DATABASE_URL:-file:/data/db.sqlite}"
export DATABASE_URL

# Single Node.js process: detect failed migrations, mark them applied, then exit.
# This replaces the previous two-process check+recover flow (saves one Node.js
# cold start — ~5-10s on Fly's shared-cpu machines). See start.sh for the
# comment on why we auto-resolve: the alternative is the app being permanently
# down after a failed migration.
#
# Uses better-sqlite3 directly instead of @prisma/client: the Prisma 7
# prisma-client generator emits a custom module in src/lib/__generated__/prisma,
# so the old require("@prisma/client") default .prisma/client/default no longer
# exists in the image. These queries only touch raw SQL, so better-sqlite3 is
# the right tool and is already a production dependency.
echo "[release] Checking for failed migrations and recovering in one shot..."
node -e '
  const Database = require("/app/node_modules/better-sqlite3");
  const db = new Database("/data/db.sqlite", { readonly: false });
  const cutoff = new Date(Date.now() - 300000).toISOString();
  try {
    const failed = db.prepare(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL AND started_at < ?"
    ).all(cutoff);
    if (failed.length > 0) {
      console.log(`[release] WARNING: detected ${failed.length} failed migration(s) from a previous deploy`);
      const markApplied = db.prepare(
        "UPDATE _prisma_migrations SET finished_at = CURRENT_TIMESTAMP WHERE migration_name = ?"
      );
      for (const m of failed) {
        markApplied.run(m.migration_name);
        console.log(`[release] Marked ${m.migration_name} as applied (recovery)`);
      }
    } else {
      console.log("[release] No failed migrations detected.");
    }
  } catch (e) {
    console.error("[release] Failed-migration check failed (non-fatal):", e.message);
  } finally {
    db.close();
  }
'

echo "[release] Running prisma migrate deploy..."
node_modules/.bin/prisma migrate deploy
