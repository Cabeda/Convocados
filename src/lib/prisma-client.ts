export * from "./__generated__/prisma/client";
export { PrismaClient as _PrismaClient } from "./__generated__/prisma/client";

import { PrismaClient as _PrismaClient } from "./__generated__/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

function makeDefaultAdapter() {
  // See db.server.ts — persist DateTime as INTEGER epoch-ms to match the
  // existing rows (iso8601 TEXT makes DateTime equality filters mismatch).
  return new PrismaBetterSqlite3(
    {
      url: process.env.DATABASE_URL || "file:./prisma/dev.db",
    },
    { timestampFormat: "unixepoch-ms" },
  );
}

export class PrismaClient extends _PrismaClient {
  constructor(options?: ConstructorParameters<typeof _PrismaClient>[0]) {
    super(options ?? { adapter: makeDefaultAdapter() });
  }
}
