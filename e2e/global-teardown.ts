import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");

/**
 * Global teardown for E2E tests.
 * Removes the e2e-test.db (and its WAL/SHM companions) so re-runs start
 * from a clean slate. Without this, leftover rows from a previous run can
 * leak into the next one (e.g. email-uniqueness collisions, lingering
 * events that break deterministic IDs in spec files).
 */
export default function globalTeardown() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // best effort — DB may still be open via the webServer process
      }
    }
  }
}
