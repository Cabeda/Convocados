import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * `--check` for the feature-parity generator.
 *
 * Without it the "gate" in `scripts/factory/gate.sh` is a no-op: the command it
 * runs is a *generator*, so it rewrote `docs/feature-parity.md` and exited 0
 * whether or not the committed file was in date. A gate that repairs the thing
 * it is checking can never report that the thing was broken.
 *
 * Measured before this test existed: stale the doc, run
 * `pnpm sync:feature-parity-docs` → exit 0.
 *
 * The child is spawned as the repo's own `node_modules/.bin/tsx`, not `npx tsx`
 * (exit 127 on CI) and not `pnpm …` (the worker re-verifies the lockfile and
 * behaved differently there). The child's output travels with every assertion so
 * a CI-only failure explains itself in one run.
 */
const ROOT = process.cwd();
const DOC = path.join(ROOT, "docs/feature-parity.md");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const SCRIPT = path.join(ROOT, "scripts", "generate-feature-parity-docs.ts");

const original = existsSync(DOC) ? readFileSync(DOC, "utf-8") : null;

afterEach(() => {
  if (original !== null) writeFileSync(DOC, original);
});

function run(args: string[]) {
  const result = spawnSync(TSX, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const DRIFT = "\n<!-- drift -->\n";

describe("feature-parity --check", () => {
  it("passes when the committed doc matches the manifest", () => {
    expect(original).not.toBeNull();
    const { status, output } = run(["--check"]);
    expect(status, output).toBe(0);
  });

  it("fails when the committed doc has drifted, and says how to fix it", () => {
    writeFileSync(DOC, (original ?? "") + DRIFT);

    const { status, output } = run(["--check"]);

    expect(status, output).toBe(1);
    // The message has to name the file and the command, or the next reader has
    // to rediscover both.
    expect(output).toMatch(/feature-parity\.md/);
    expect(output).toMatch(/sync:feature-parity-docs/);
  });

  it("does not repair the file it is checking", () => {
    // The generator's whole hazard: it would silently fix the drift, so the gate
    // would pass and the stale file would never reach a reviewer.
    writeFileSync(DOC, (original ?? "") + DRIFT);

    run(["--check"]);

    expect(readFileSync(DOC, "utf-8")).toContain("<!-- drift -->");
  });

  it("still writes when --check is absent, so the generator keeps working", () => {
    writeFileSync(DOC, "stale");

    const { status, output } = run([]);

    expect(status, output).toBe(0);
    expect(readFileSync(DOC, "utf-8")).toBe(original);
  });
});
