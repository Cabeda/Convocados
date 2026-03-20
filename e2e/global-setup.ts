import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");

/**
 * Global setup for E2E tests.
 * Creates a fresh database with migrations applied.
 */
export default function globalSetup() {
  // Clean any leftover DB from a previous run (including WAL files)
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  // Run migrations to create the schema
  execSync("npx prisma migrate deploy", {
    env: {
      ...process.env,
      DATABASE_URL: `file:${DB_PATH}`,
    },
    stdio: "pipe",
  });
}
