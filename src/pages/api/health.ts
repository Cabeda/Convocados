import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { prisma, prismaReady } from "../../lib/db.server";
import { SCHEDULER_HEARTBEAT_ID, countFailedJobs } from "../../lib/scheduler.server";
import { createLogger } from "../../lib/logger.server";

const log = createLogger("health");

/** Scheduler polls every 5–30s; anything older than 3min means it's down.
 * (3min tolerates maintenance timeouts + rotating deploys without false alarms.) */
const SCHEDULER_STALE_MS = 3 * 60 * 1000;

/** Litestream only syncs when the WAL changes, so a quiet night is not a
 * failure. A full day without a successful sync is: the R2 outage in #1487
 * went unnoticed for ~95h because health only checked the supervisor process. */
const LITESTREAM_STALE_SECONDS = 24 * 60 * 60;
const LITESTREAM_SOCKET = "/var/run/litestream.sock";

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL || "file:./prisma/dev.db";
  return url.replace(/^file:/, "");
}

export const GET: APIRoute = async () => {
  try {
    // Surface startup-pragma failures instead of silently swallowing them:
    // if WAL/optimize/etc. couldn't be applied, the DB is not healthy.
    await prismaReady;
    // Verify both read and write capability
    await prisma.$queryRaw`SELECT 1`;
    // Write check: SQLite-specific — verify WAL mode is active
    const pragmaResult = await prisma.$queryRawUnsafe(
      "PRAGMA journal_mode"
    ) as { journal_mode: string }[];
    const journalMode = pragmaResult[0]?.journal_mode ?? "unknown";

    // Size/drift metrics: page_count is the total file size in pages,
    // freelist_count is pages freed by deletes that were never reclaimed —
    // a large ratio here means VACUUM/incremental_vacuum is overdue.
    const pageCountResult = await prisma.$queryRawUnsafe("PRAGMA page_count") as Record<string, bigint>[];
    const freelistResult = await prisma.$queryRawUnsafe("PRAGMA freelist_count") as Record<string, bigint>[];
    let walSizeBytes = 0;
    try {
      walSizeBytes = (await fs.stat(`${resolveDbPath()}-wal`)).size;
    } catch {
      // WAL file may not exist yet (no writes since open); 0 is accurate then
    }

    const response: Record<string, unknown> = {
      status: "ok",
      db: {
        journalMode,
        writable: true,
        pageCount: Number(Object.values(pageCountResult[0] ?? {})[0] ?? 0),
        freelistCount: Number(Object.values(freelistResult[0] ?? {})[0] ?? 0),
        walSizeBytes,
      },
    };

    // In production, check Litestream. Process-up is not replication-current:
    // `litestream list` reads the daemon's last successful sync from the
    // control socket (enabled in litestream.yml).
    if (process.env.NODE_ENV === "production") {
      let running = false;
      const { execSync } = await import("node:child_process");
      try {
        execSync("pgrep -x litestream", { timeout: 1000, stdio: "ignore" });
        running = true;
      } catch {
        // pgrep exits non-zero when no process matches
      }

      let status: string | null = null;
      let lastSyncAt: string | null = null;
      let syncAgeSeconds: number | null = null;
      try {
        const output = execSync(`litestream list -json -socket ${LITESTREAM_SOCKET}`, {
          timeout: 1500,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const parsed = JSON.parse(output) as {
          databases?: Array<{ path?: string; status?: string; last_sync_at?: string }>;
        };
        const databases = Array.isArray(parsed.databases) ? parsed.databases : [];
        const database = databases.find((row) => row.path === resolveDbPath()) ?? databases[0];
        if (database) {
          status = typeof database.status === "string" ? database.status : null;
          lastSyncAt = typeof database.last_sync_at === "string" ? database.last_sync_at : null;
          if (lastSyncAt) {
            const ageMs = Date.now() - new Date(lastSyncAt).getTime();
            if (Number.isFinite(ageMs)) syncAgeSeconds = Math.max(0, Math.floor(ageMs / 1000));
          }
        }
      } catch {
        // Socket not enabled yet (old deploy) or daemon still starting; the
        // process check above still reports what it can.
      }
      response.litestream = { running, status, lastSyncAt, syncAgeSeconds };
      // A replica that has never recorded a successful sync after a full day of
      // uptime is a failing replica, not a quiet one. The R2 outage in #1487
      // keeps `status: replicating` with no `last_sync_at`.
      const neverSynced =
        running &&
        status === "replicating" &&
        lastSyncAt === null &&
        process.uptime() > LITESTREAM_STALE_SECONDS;
      if (
        !running ||
        (status !== null && status !== "replicating") ||
        (syncAgeSeconds !== null && syncAgeSeconds > LITESTREAM_STALE_SECONDS) ||
        neverSynced
      ) {
        response.degraded = true;
      }

      // Check the scheduler heartbeat — a stale one means reminders are stuck.
      // Report it as degraded but DON'T fail the check: the scheduler polls the
      // app via its public URL, so a 503 here removes the instance from the load
      // balancer, which the scheduler can then never reach to refresh the
      // heartbeat — the app stays down until manual DB intervention (deadlock).
      const heartbeat = await prisma.schedulerHeartbeat.findUnique({
        where: { id: SCHEDULER_HEARTBEAT_ID },
      });
      const schedulerRunning =
        !!heartbeat && Date.now() - heartbeat.lastSeenAt.getTime() < SCHEDULER_STALE_MS;
      // Dead-lettered jobs (retry exhausted) are reported for visibility but
      // don't degrade health: they need human attention, not an instance kill.
      const failedJobs = await countFailedJobs();
      response.scheduler = { running: schedulerRunning, failedJobs };
      if (!schedulerRunning) {
        response.degraded = true;
      }
    }

    return Response.json(response);
  } catch (err) {
    // Log the detail server-side; never echo internal error text publicly.
    log.error({ err }, "health check failed");
    return Response.json({ status: "error" }, { status: 503 });
  }
};
