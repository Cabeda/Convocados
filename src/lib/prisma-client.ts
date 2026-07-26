export * from "./__generated__/prisma/client";
export { PrismaClient as _PrismaClient } from "./__generated__/prisma/client";

import { PrismaClient as _PrismaClient } from "./__generated__/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

function makeDefaultAdapter() {
  return new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || "file:./prisma/dev.db",
  });
}

export class PrismaClient extends _PrismaClient {
  constructor(options?: ConstructorParameters<typeof _PrismaClient>[0]) {
    super(options ?? { adapter: makeDefaultAdapter() });
  }
}
