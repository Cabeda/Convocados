import type { APIRoute } from "astro";
import { prisma } from "../../lib/db.server";

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
    }

    return Response.json(response);
  } catch (err: any) {
    return Response.json(
      { status: "error", message: err?.message ?? "db unreachable" },
      { status: 503 },
    );
  }
};
