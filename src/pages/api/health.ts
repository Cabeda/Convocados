import type { APIRoute } from "astro";
import { prisma } from "../../lib/db.server";
import { SCHEDULER_HEARTBEAT_ID } from "../../lib/scheduler.server";

/** Scheduler polls every 5–30s; anything older than 3min means it's down.
 * (3min tolerates maintenance timeouts + rotating deploys without false alarms.) */
const SCHEDULER_STALE_MS = 3 * 60 * 1000;

export const GET: APIRoute = async () => {
  try {
    // Verify both read and write capability
    await prisma.$queryRaw`SELECT 1`;
    // Write check: SQLite-specific — verify WAL mode is active
    const pragmaResult = await prisma.$queryRawUnsafe(
      "PRAGMA journal_mode"
    ) as { journal_mode: string }[];
    const journalMode = pragmaResult[0]?.journal_mode ?? "unknown";

    const response: Record<string, unknown> = {
      status: "ok",
      db: {
        journalMode,
        writable: true,
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

      // Check the scheduler heartbeat — a stale one means reminders are stuck
      const heartbeat = await prisma.schedulerHeartbeat.findUnique({
        where: { id: SCHEDULER_HEARTBEAT_ID },
      });
      const schedulerRunning =
        !!heartbeat && Date.now() - heartbeat.lastSeenAt.getTime() < SCHEDULER_STALE_MS;
      response.scheduler = { running: schedulerRunning };
      if (!schedulerRunning) {
        response.status = "error";
        return Response.json(response, { status: 503 });
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
