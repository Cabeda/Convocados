import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { prisma, prismaReady } from "../../lib/db.server";
import { SCHEDULER_HEARTBEAT_ID } from "../../lib/scheduler.server";

/** Scheduler polls every 5–30s; anything older than 3min means it's down.
 * (3min tolerates maintenance timeouts + rotating deploys without false alarms.) */
const SCHEDULER_STALE_MS = 3 * 60 * 1000;

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

    // In production, check if Litestream replication process is running
    if (process.env.NODE_ENV === "production") {
      let running = false;
      try {
        const { execSync } = await import("node:child_process");
        execSync("pgrep -x litestream", { timeout: 1000 });
        running = true;
      } catch {
        // pgrep exits non-zero when no process matches
      }
      response.litestream = { running };

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
      response.scheduler = { running: schedulerRunning };
      if (!schedulerRunning) {
        response.degraded = true;
      }
    }

    return Response.json(response);
  } catch (err) {
    return Response.json(
      { status: "error", message: err instanceof Error ? err.message : "db unreachable" },
      { status: 503 },
    );
  }
};
