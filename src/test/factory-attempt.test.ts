/**
 * The Attempt ledger is the only thing that stops the Reviewer and the Fixer
 * arguing forever: `scripts/factory/attempt.ts` writes one comment per round and
 * `next-fix.ts` counts them. A write that fails silently reports a round GitHub
 * never recorded, so the count stays at zero, the same Change is picked again,
 * and the three-round handoff to Cabeda can never fire.
 *
 * Reproduced 2026-11-27 on PR #1873: the ledger logged "Attempt 1 recorded
 * (budget 3)" at 13:18 while the Change carried zero attempt comments. The write
 * now exits 2 on failure and 1 when the budget is spent, because the ledger has
 * to tell those apart. These tests drive the real script with a stubbed `gh`.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
let dir: string;
let binDir: string;

/**
 * A `gh` that answers `pr view` and fails `pr comment`.
 * `attempts` is how many attempt comments already exist on the Change.
 */
function stubGh({ attempts = 0, commentExit = 1 }: { attempts?: number; commentExit?: number } = {}) {
  const comments = Array.from({ length: attempts }, (_, i) => ({
    body: `factory: attempt <review> (${i + 1}/3)`,
  }));
  const path = join(binDir, "gh");
  writeFileSync(
    path,
    `#!/bin/sh
case "$1 $2" in
  "pr view")
    case "$*" in
      *"--json number"*) echo 1873 ;;
      *) echo '{"comments":${JSON.stringify(comments)},"labels":[]}' ;;
    esac
    ;;
  "pr comment") echo "HTTP 403: Resource not accessible by integration" >&2; exit ${commentExit} ;;
esac
exit 0
`,
  );
  chmodSync(path, 0o755);
}

function runAttempt(...args: string[]) {
  return spawnSync("node", ["scripts/factory/attempt.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attempt-test-"));
  binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("recording an Attempt", () => {
  it("exits 2 and records nothing when the comment cannot be written", () => {
    stubGh({ commentExit: 1 });
    const result = runAttempt("1873", "review", "--set");
    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain("recorded");
    expect(result.stderr).toContain("could not be recorded");
    // gh's own message, not just the command line: a 403 that prints only the
    // invocation cost an hour of guessing on 2026-11-27.
    expect(result.stderr).toContain("HTTP 403");
  });

  it("exits 1, not 2, when the round spends the budget", () => {
    // Exit 1 is the signal the ledger tolerates and still runs the round on.
    // Collapsing it into the write failure is what let an unrecorded round run.
    stubGh({ attempts: 3, commentExit: 0 });
    const result = runAttempt("1873", "review", "--set");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("recorded");
  });

  it("exits 0 when a normal round is recorded", () => {
    stubGh({ attempts: 0, commentExit: 0 });
    const result = runAttempt("1873", "review", "--set");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Attempt 1 recorded");
  });
});
