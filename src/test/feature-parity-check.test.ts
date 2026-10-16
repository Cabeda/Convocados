import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * `--check` for the feature-parity generator.
 *
 * Without it the "gate" in `scripts/factory/gate.sh` is a no-op: the command it
 * runs is a *generator*, so it rewrites `docs/feature-parity.md` and exits 0
 * whether or not the committed file was in date. A gate that repairs the thing
 * it is checking can never report that the thing was broken.
 *
 * Verified by experiment before this test existed: stale the doc, run
 * `pnpm sync:feature-parity-docs` → exit 0.
 */
const ROOT = process.cwd();
const DOC = path.join(ROOT, "docs/feature-parity.md");
const SCRIPT = path.join(ROOT, "scripts/generate-feature-parity-docs.ts");

const original = existsSync(DOC) ? readFileSync(DOC, "utf-8") : null;

afterEach(() => {
  if (original !== null) writeFileSync(DOC, original);
});

function runCheck() {
  return spawnSync("npx", ["tsx", SCRIPT, "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
}

describe("feature-parity --check", () => {
  it("passes when the committed doc matches the manifest", () => {
    expect(original).not.toBeNull();
    const result = runCheck();
    expect(result.status).toBe(0);
  });

  it("fails when the committed doc has drifted, and says how to fix it", () => {
    writeFileSync(DOC, (original ?? "") + "\n<!-- drift -->\n");

    const result = runCheck();

    expect(result.status).toBe(1);
    // The message has to name the file and the command, or the next reader has
    // to rediscover both.
    expect(result.stderr + result.stdout).toMatch(/feature-parity\.md/);
    expect(result.stderr + result.stdout).toMatch(/sync:feature-parity-docs/);
  });

  it("does not repair the file it is checking", () => {
    // The generator's whole hazard: it would silently fix the drift, so the gate
    // would pass and the stale file would never reach a reviewer.
    writeFileSync(DOC, (original ?? "") + "\n<!-- drift -->\n");

    runCheck();

    expect(readFileSync(DOC, "utf-8")).toContain("<!-- drift -->");
  });

  it("still writes when --check is absent, so the generator keeps working", () => {
    writeFileSync(DOC, "stale");

    const result = spawnSync("npx", ["tsx", SCRIPT], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });

    expect(result.status).toBe(0);
    expect(readFileSync(DOC, "utf-8")).toBe(original);
  });
});
