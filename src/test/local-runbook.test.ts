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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("the local runbook", () => {
  it("runs the one file the caller named, separator or not", () => {
    for (const args of [
      ["--list", "--reporter=list", "e2e/health.spec.ts"],
      ["--", "--list", "--reporter=list", "e2e/health.spec.ts"],
    ]) {
      const output = execFileSync("sh", ["scripts/e2e.sh", ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      // "Listing … in 1 file" is what tells a *listing* from a *run*: with the
      // `--` left in, the flags become file filters and the whole suite runs.
      // The file count is what matters, not the test count — a spec that gains a
      // test must not break the unit suite.
      expect(output, `pnpm test:e2e ${args.join(" ")} must list the named file`).toMatch(
        /Total: \d+ tests? in 1 file/,
      );
      expect(output, `pnpm test:e2e ${args.join(" ")} must run the named file`).toContain(
        "health.spec.ts",
      );
      expect(output, `pnpm test:e2e ${args.join(" ")} must not run the whole suite`).not.toContain(
        "notifications.spec.ts",
      );
    }
  });

  it("lets the caller's DATABASE_URL win over .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "with-env-"));
    writeFileSync(join(dir, ".env"), "DATABASE_URL=file:./from-env.db\n");
    // The script reads ./.env from the working directory, so it runs in the
    // temp directory — but it is the repo's script, by absolute path.
    const script = join(root, "scripts/with-env.sh");

    // `env` prints the environment the command was given. It is a constant
    // command, so nothing is interpolated into a shell line.
    const withCaller = execFileSync("sh", [script, "env"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "file:./caller.db" },
    });
    expect(withCaller).toContain("DATABASE_URL=file:./caller.db");

    const withoutCaller = execFileSync("sh", [script, "env"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" },
    });
    expect(withoutCaller).toContain("DATABASE_URL=file:./from-env.db");
  });

  it("survives a .env line that fails", () => {
    // A developer's .env may run a command that fails (a missing tool, a
    // substitution that errors). Sourcing it under `set -e` would abort the
    // command the caller asked for.
    const dir = mkdtempSync(join(tmpdir(), "with-env-"));
    writeFileSync(join(dir, ".env"), "TOOL=$(exit 1)\nDATABASE_URL=file:./from-env.db\n");
    const script = join(root, "scripts/with-env.sh");

    const output = execFileSync("sh", [script, "env"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" },
    });
    expect(output).toContain("DATABASE_URL=file:./from-env.db");
  });

  it("is what the package scripts run", () => {
    // The scripts above are only reachable if package.json points at them:
    // reverting the wiring would bring the e2e bug back, and this test red.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts["test:e2e"]).toContain("scripts/e2e.sh");
    for (const [name, command] of Object.entries(pkg.scripts)) {
      // The scripts that read the database are the ones that source .env.
      if (!/^db:(seed|repair|backfill)/.test(name)) continue;
      expect(command, `${name} must run through scripts/with-env.sh`).toContain("scripts/with-env.sh");
    }
  });
});
