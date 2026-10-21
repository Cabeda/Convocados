/**
 * The dex ledger must be in the working tree.
 *
 * The failure this replaces: `git stash push -- .dex` takes the tracker out of
 * the working tree, and dex reads the working tree — so the task list silently
 * disappeared while the tasks sat in the stash. The ledger is the tracker, so
 * `scripts/dex-dedupe.mjs --check` now reports that case by name.
 *
 * The test runs against a throwaway git repository: stashing the *real* ledger
 * to prove the point would be the mistake the check exists to catch.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const source = join(process.cwd(), "scripts/dex-dedupe.mjs");

let repo = "";
let workdir = "";
let script = "";

function git(args: string[], cwd = workdir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runDedupe(cwd = workdir): { status: number; output: string } {
  try {
    const output = execFileSync("node", [script], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "dex-ledger-"));
  repo = workdir;
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  mkdirSync(join(repo, ".dex"), { recursive: true });
  mkdirSync(join(repo, "scripts"), { recursive: true });
  // The script reads the repo it lives in, so the throwaway repo gets its own
  // copy: stashing the *real* ledger to prove the point would be the mistake
  // the check exists to catch.
  script = join(repo, "scripts/dex-dedupe.mjs");
  copyFileSync(source, script);
  writeFileSync(
    join(repo, ".dex/tasks.jsonl"),
    `${JSON.stringify({ id: "aaa", name: "One", updated_at: "2026-01-01" })}\n${JSON.stringify({ id: "bbb", name: "Two", updated_at: "2026-01-02" })}\n`,
  );
  git(["add", "."]);
  git(["commit", "-q", "-m", "ledger"]);
});

afterEach(() => {
  if (workdir) git(["stash", "clear"], workdir);
});

describe("the dex ledger in the working tree", () => {
  it("passes when the ledger is there", () => {
    const { status, output } = runDedupe();
    expect(status).toBe(0);
    expect(output).toContain("already unique");
  });

  it("names the stash when the ledger is newer there than in the working tree", () => {
    // A task created after the stash: dex reads the working tree, so it is
    // invisible until the stash is popped.
    writeFileSync(
      join(repo, ".dex/tasks.jsonl"),
      `${JSON.stringify({ id: "aaa", name: "One", updated_at: "2026-01-01" })}\n${JSON.stringify({ id: "bbb", name: "Two", updated_at: "2026-01-02" })}\n${JSON.stringify({ id: "ccc", name: "Three", updated_at: "2026-01-03" })}\n`,
    );
    git(["stash", "push", "-q", "--", ".dex"]);

    const { status, output } = runDedupe();
    expect(status).toBe(1);
    expect(output).toContain("stash@{0}");
    expect(output).toContain("ccc");
    expect(output).toContain("git stash pop");
  });

  it("passes again once the stash is restored", () => {
    writeFileSync(
      join(repo, ".dex/tasks.jsonl"),
      `${JSON.stringify({ id: "aaa", name: "One", updated_at: "2026-01-01" })}\n${JSON.stringify({ id: "bbb", name: "Two", updated_at: "2026-01-02" })}\n${JSON.stringify({ id: "ccc", name: "Three", updated_at: "2026-01-03" })}\n`,
    );
    git(["stash", "push", "-q", "--", ".dex"]);
    expect(runDedupe().status).toBe(1);

    git(["stash", "pop", "-q"]);
    expect(runDedupe().status).toBe(0);
  });
});
