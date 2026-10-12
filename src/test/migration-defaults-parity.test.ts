/**
 * Event column-default parity: prisma/migrations vs prisma/schema.prisma (GH #1275).
 *
 * The test DB is built by src/test/globalSetup.ts by replaying every
 * prisma/migrations migration.sql in order, so the column defaults it ends up
 * with are exactly the ones production has. When schema.prisma declares a
 * different default than the migration history does, `prisma migrate dev`
 * renders a full table rebuild for the next unrelated schema change — drift
 * that this test pins shut.
 *
 * Concrete case: Event.hideEloInTeams was created DEFAULT false
 * (20260417120000_add_hide_elo_in_teams) and only backfilled to true
 * (20260918190000_hide_elo_in_teams_default_true), while schema.prisma:181
 * declares @default(true).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const SCHEMA_PATH = path.join(root, "prisma/schema.prisma");
const MIGRATIONS_DIR = path.join(root, "prisma/migrations");

/** The per-worker DB src/test/setup.ts copies from the migration-built base. */
function testDbPath(): string {
  const raw = (process.env.DATABASE_URL ?? "file:./prisma/test.db").replace(/^file:/, "");
  return path.isAbsolute(raw) ? raw : path.resolve(root, raw.split("?")[0]);
}

/** Prisma function defaults the client evaluates, so SQLite stores no DEFAULT. */
const CLIENT_SIDE_DEFAULTS = new Set(["cuid()", "uuid()", "autoincrement()"]);

/**
 * Map a schema.prisma @default(...) expression onto the DEFAULT SQLite reports
 * through `PRAGMA table_info`. `@updatedAt` and missing attributes mean "no
 * declared default".
 */
function schemaDefaultToSql(expr: string | undefined): string | null {
  if (expr === undefined) return null;
  const value = expr.trim();
  if (CLIENT_SIDE_DEFAULTS.has(value)) return null;
  if (value === "now()") return "CURRENT_TIMESTAMP";
  if (value.startsWith('"') && value.endsWith('"')) return `'${value.slice(1, -1)}'`;
  return value;
}

/** Scalar fields of `model Event` mapped to their declared default (or null). */
function eventFieldDefaults(schemaText: string): Record<string, string | null> {
  const modelStart = schemaText.indexOf("model Event {");
  expect(modelStart).toBeGreaterThan(-1);
  const modelEnd = schemaText.indexOf("\n}", modelStart);
  const body = schemaText.slice(schemaText.indexOf("{", modelStart) + 1, modelEnd);

  const fields: Record<string, string | null> = {};
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    const field = /^(\w+)\s+(Boolean|Int|Float|String|DateTime)(\?)?(?:\s+@default\(((?:[^()]|\(\))*)\))?/.exec(line);
    if (!field) continue;
    fields[field[1]] = schemaDefaultToSql(field[4]);
  }
  return fields;
}

describe("Event column defaults: migration history vs schema.prisma", () => {
  const schemaText = fs.readFileSync(SCHEMA_PATH, "utf8");
  const declared = eventFieldDefaults(schemaText);

  it("reads defaults from a database built by replaying the migration history", () => {
    const db = new Database(testDbPath(), { readonly: true });
    try {
      const history = db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '_prisma_migrations'")
        .get() as { n: number };
      expect(history.n).toBe(1);

      const migrationDirs = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((d) => fs.statSync(path.join(MIGRATIONS_DIR, d)).isDirectory());
      const applied = db.prepare("SELECT COUNT(*) AS n FROM _prisma_migrations").get() as { n: number };
      expect(applied.n).toBe(migrationDirs.length);
    } finally {
      db.close();
    }
  });

  it("every Event scalar column default in the DB matches the schema declaration", () => {
    const db = new Database(testDbPath(), { readonly: true });
    let mismatches: string[];
    try {
      const columns = db.prepare("PRAGMA table_info('Event')").all() as Array<{
        name: string;
        dflt_value: string | null;
      }>;
      mismatches = columns
        .map((c) => ({ name: c.name, actual: c.dflt_value, expected: declared[c.name] ?? null }))
        .filter((c) => c.actual !== c.expected)
        .map((c) => `${c.name}: DB DEFAULT ${c.actual} vs schema.prisma ${c.expected}`);
    } finally {
      db.close();
    }
    expect(mismatches).toEqual([]);
  });

  it("Event.hideEloInTeams defaults to true, as schema.prisma declares", () => {
    expect(declared.hideEloInTeams).toBe("true");

    const db = new Database(testDbPath(), { readonly: true });
    let actual: string | null;
    try {
      const column = (
        db.prepare("PRAGMA table_info('Event')").all() as Array<{
          name: string;
          dflt_value: string | null;
        }>
      ).find((c) => c.name === "hideEloInTeams");
      expect(column).toBeDefined();
      actual = column!.dflt_value;
    } finally {
      db.close();
    }
    expect(actual).toBe(declared.hideEloInTeams);
  });
});
