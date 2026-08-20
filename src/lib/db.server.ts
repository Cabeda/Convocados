import { PrismaClient, Prisma } from "./__generated__/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

let prisma: PrismaClient;
let prismaReady: Promise<void>;

declare global {
  var __prisma: PrismaClient | undefined;
  var __prismaReady: Promise<void> | undefined;
}

async function applyPragmas(client: PrismaClient): Promise<void> {
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  await client.$queryRawUnsafe("PRAGMA synchronous = NORMAL");
  await client.$queryRawUnsafe("PRAGMA cache_size = -20000");
  await client.$queryRawUnsafe("PRAGMA foreign_keys = ON");
  await client.$queryRawUnsafe("PRAGMA mmap_size = 67108864");
  // Long-lived connection: let SQLite keep query plans/statistics fresh.
  // Mask 0x10002 = run ANALYZE where the query planner suggests, skipping
  // tables with >1M rows so startup stays fast. (sqlite.org/pragma.html)
  await client.$queryRawUnsafe("PRAGMA optimize=0x10002");
  await client.$queryRawUnsafe("PRAGMA temp_store = MEMORY");
  // Bound the WAL file so it can't balloon unbounded after checkpoints.
  await client.$queryRawUnsafe("PRAGMA journal_size_limit = 67108864");
}

/** Periodic query-plan maintenance. The scheduler worker calls this once per
 * day via POST /api/cron/db-maintenance — the app itself never holds a timer
 * (it suspends on inactivity). */
export function runDbOptimize(): Promise<unknown> {
  return prisma.$queryRawUnsafe("PRAGMA optimize");
}

function createClient(): { client: PrismaClient; ready: Promise<void> } {
  // timestampFormat: unixepoch-ms — persist DateTime as INTEGER epoch-ms, the
  // format the DB already holds (Prisma 6's built-in SQLite connector wrote
  // integers). The adapter default (iso8601 TEXT) makes DateTime equality
  // filters (e.g. the lazy recurrence reset's CAS on nextResetAt) mismatch
  // every pre-existing row and silently no-op.
  const adapter = new PrismaBetterSqlite3(
    {
      url: process.env.DATABASE_URL || "file:./prisma/dev.db",
    },
    { timestampFormat: "unixepoch-ms" },
  );
  const client = new PrismaClient({ adapter });
  return { client, ready: applyPragmas(client) };
}

if (process.env.NODE_ENV === "production") {
  const { client, ready } = createClient();
  prisma = client;
  prismaReady = ready;
} else {
  if (!global.__prisma) {
    const { client, ready } = createClient();
    global.__prisma = client;
    global.__prismaReady = ready;
  }
  prisma = global.__prisma;
  prismaReady = global.__prismaReady!;
}

export { Prisma, prisma, prismaReady, applyPragmas };