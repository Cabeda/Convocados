import { PrismaClient, Prisma } from "./__generated__/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

let prisma: PrismaClient;

declare global {
  var __prisma: PrismaClient | undefined;
}

async function applyPragmas(client: PrismaClient): Promise<void> {
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  await client.$queryRawUnsafe("PRAGMA synchronous = NORMAL");
  await client.$queryRawUnsafe("PRAGMA cache_size = -20000");
  await client.$queryRawUnsafe("PRAGMA foreign_keys = ON");
  await client.$queryRawUnsafe("PRAGMA mmap_size = 67108864");
}

function createClient(): PrismaClient {
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
  applyPragmas(client).catch(() => {});
  return client;
}

if (process.env.NODE_ENV === "production") {
  prisma = createClient();
} else {
  if (!global.__prisma) {
    global.__prisma = createClient();
  }
  prisma = global.__prisma;
}

export { Prisma, prisma, applyPragmas };
