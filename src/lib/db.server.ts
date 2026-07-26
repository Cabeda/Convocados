import { PrismaClient, Prisma } from "./__generated__/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

let prisma: PrismaClient;

declare global {
  var __prisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || "file:./prisma/dev.db",
  });
  const client = new PrismaClient({ adapter });
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

export { Prisma, prisma };
