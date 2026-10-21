/**
 * The two local commands that silently did something else.
 *
 * - `pnpm test:e2e -- --grep foo` ran the **whole** suite: pnpm passes the
 *   `--` through, and Playwright reads it as "end of options", so every
 *   argument after it became a file filter.
 * - `pnpm db:seed` ignored the `DATABASE_URL` the caller named, because the
 *   script sourced `./.env` afterwards — so the seed ran against the
 *   developer's local `dev.db`, and failed on a column that had been added by a
 *   migration since that database was created.
 *
 * Both are the kind of thing that costs an afternoon, so both are pinned here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("the local runbook", () => {
  it("runs the one test the caller named, separator or not", () => {
    for (const args of [["--list", "e2e/health.spec.ts"], ["--", "--list", "e2e/health.spec.ts"]]) {
      const output = execFileSync("sh", ["scripts/e2e.sh", ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(
        output,
        `pnpm test:e2e ${args.join(" ")} must run the named test, not the whole suite`,
      ).toContain("Total: 1 test in 1 file");
    }
  });

  it("lets the caller's DATABASE_URL win over .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "with-env-"));
    writeFileSync(join(dir, ".env"), "DATABASE_URL=file:./from-env.db\n");
    // The script reads ./.env from the working directory, so it runs in the
    // temp directory — but it is the repo's script, by absolute path.
    const script = join(root, "scripts/with-env.sh");

    const withCaller = execFileSync("sh", [script, "sh", "-c", "echo $DATABASE_URL"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "file:./caller.db" },
    });
    expect(withCaller.trim()).toBe("file:./caller.db");

    const withoutCaller = execFileSync("sh", [script, "sh", "-c", "echo $DATABASE_URL"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" },
    });
    expect(withoutCaller.trim()).toBe("file:./from-env.db");
  });
});
