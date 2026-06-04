import { readdirSync } from "fs";
import type { PrismaClient } from "@prisma/client";
import { createLogger } from "./logger.server";

const log = createLogger("schema-check");

export interface MigrationDrift {
  hasDrift: boolean;
  missingFromDb: string[];
  missingFromFs: string[];
}

/**
 * Compares migrations recorded in `_prisma_migrations` against the migration
 * files on disk. Detects two kinds of drift:
 *
 * - `missingFromDb`:  A migration file exists on disk that has not been
 *                     applied (the DB is behind the schema in the image).
 * - `missingFromFs`:  The DB has an applied migration whose file is gone
 *                     (someone removed a migration from the image).
 *
 * This is a defense-in-depth check run after `prisma migrate deploy` in
 * start.sh. The release_command in fly.toml is the primary safety net; this
 * catches the case where the image is stale or the release command was
 * skipped for some reason.
 */
export async function checkSchemaDrift(
  prisma: PrismaClient,
  migrationsDir: string,
): Promise<MigrationDrift> {
  const appliedRows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    "SELECT migration_name FROM _prisma_migrations ORDER BY migration_name",
  );
  const applied = new Set(appliedRows.map((r) => r.migration_name));

  let onDisk: string[];
  try {
    onDisk = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    log.warn({ err, migrationsDir }, "Could not read migrations directory");
    return { hasDrift: true, missingFromDb: [], missingFromFs: [] };
  }

  const appliedSorted = [...applied].sort();
  const missingFromDb = onDisk.filter((name) => !applied.has(name));
  const missingFromFs = appliedSorted.filter((name) => !onDisk.includes(name));

  return {
    hasDrift: missingFromDb.length > 0 || missingFromFs.length > 0,
    missingFromDb,
    missingFromFs,
  };
}

/**
 * Logs drift as a structured warning. Returns the result so callers can also
 * act on it (e.g., set process exit code in a script).
 */
export async function runSchemaDriftCheck(
  prisma: PrismaClient,
  migrationsDir: string,
): Promise<MigrationDrift> {
  const result = await checkSchemaDrift(prisma, migrationsDir);
  if (result.hasDrift) {
    log.warn(
      {
        missingFromDb: result.missingFromDb,
        missingFromFs: result.missingFromFs,
        migrationsDir,
      },
      "Schema drift detected — DB and filesystem migrations are out of sync. " +
        "If missingFromDb is non-empty, the new code references tables/columns " +
        "the DB doesn't have and will fail at runtime.",
    );
  } else {
    log.info({ migrationsDir }, "Schema is in sync with migrations directory");
  }
  return result;
}
