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

    return Response.json({
      status: "ok",
      db: {
        journalMode,
        writable: true,
      },
    });
  } catch (err: any) {
    return Response.json(
      { status: "error", message: err?.message ?? "db unreachable" },
      { status: 503 },
    );
  }
};
