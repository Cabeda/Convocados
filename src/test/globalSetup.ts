import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(__dirname, "../../test.db");

export function setup() {
  // Clean any leftover DB from a previous run
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-journal`)) fs.unlinkSync(`${TEST_DB_PATH}-journal`);

  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;

  execSync(`npx prisma migrate deploy`, {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
    stdio: "pipe",
  });
}

export function teardown() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-journal`)) fs.unlinkSync(`${TEST_DB_PATH}-journal`);
}
