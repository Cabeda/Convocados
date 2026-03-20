import { PrismaClient } from "@prisma/client";
import { createLogger } from "./logger.server";

const log = createLogger("db");

let prisma: PrismaClient;

declare global {
  var __prisma: PrismaClient | undefined;
}

/**
 * Apply SQLite production PRAGMAs for performance and reliability.
 * - WAL mode: allows concurrent readers during writes
 * - busy_timeout: wait up to 5s instead of failing immediately on lock
 * - synchronous=NORMAL: safe with WAL, better write performance
 * - cache_size: 20MB page cache for read performance
 * - foreign_keys: enforce FK constraints at the database level
 *
 * Note: SQLite PRAGMAs that set values also return results,
 * so we must use $queryRawUnsafe (not $executeRawUnsafe).
 */
async function applyPragmas(client: PrismaClient): Promise<void> {
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  await client.$queryRawUnsafe("PRAGMA synchronous = NORMAL");
  await client.$queryRawUnsafe("PRAGMA cache_size = -20000");
  await client.$queryRawUnsafe("PRAGMA foreign_keys = ON");
}

function createClient(): PrismaClient {
  const client = new PrismaClient();
  // Apply PRAGMAs on first use — Prisma lazy-connects, so we trigger it
  applyPragmas(client).catch((err) => {
    log.error({ err }, "Failed to apply SQLite PRAGMAs");
  });
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

export { prisma, applyPragmas };
