import type { APIRoute } from "astro";
import { resolve } from "path";
import { prisma } from "../../../lib/db.server";
import { checkSchemaDrift } from "../../../lib/schemaCheck.server";

const DEFAULT_MIGRATIONS_DIR = resolve(process.cwd(), "prisma", "migrations");

export const GET: APIRoute = async () => {
  const migrationsDir = process.env.MIGRATIONS_DIR
    ? resolve(process.env.MIGRATIONS_DIR)
    : DEFAULT_MIGRATIONS_DIR;

  try {
    const appliedRows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations ORDER BY migration_name",
    );
    const applied = appliedRows.map((r) => r.migration_name);

    const drift = await checkSchemaDrift(prisma, migrationsDir);

    return Response.json({
      status: drift.hasDrift ? "drift" : "in_sync",
      applied,
      missingFromDb: drift.missingFromDb,
      missingFromFs: drift.missingFromFs,
      migrationsDir,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    return Response.json(
      { status: "error", message },
      { status: 503 },
    );
  }
};
