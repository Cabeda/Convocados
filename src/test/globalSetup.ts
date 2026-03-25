import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(__dirname, "../../test.db");

export function setup() {
  // Clean any leftover DB from a previous run (including WAL files)
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  process.env.BETTER_AUTH_URL = "http://localhost:4321";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

  execSync(`npx prisma migrate deploy`, {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
    stdio: "pipe",
  });
}

export function teardown() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
