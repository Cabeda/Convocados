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

/**
 * Git commands in the throwaway repo must not see the real repository.
 *
 * The suite also runs from inside git hooks (the pre-push hook runs the whole
 * suite), and a hook's environment carries GIT_DIR — pointing at the real
 * repository. Without scrubbing it, `git init` and `git config` here rewrite
 * the *real* repository's config: `core.bare` becomes true (which breaks
 * `git rev-parse --show-toplevel`, and with it the pre-push hook itself) and
 * the commit identity is replaced by the throwaway one.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_COMMON_DIR;
  return env;
}

function git(args: string[], cwd = workdir): string {
  return execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The real repository's local config, to prove the throwaway never touches it. */
function realRepoConfig(): string {
  try {
    return execFileSync("git", ["config", "--local", "--list"], {
      cwd: process.cwd(),
      env: gitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

const realRepoConfigBefore = realRepoConfig();

function runDedupe(cwd = workdir): { status: number; output: string } {
  try {
    const output = execFileSync("node", [script], {
      cwd,
      env: gitEnv(),
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
  it("leaves the real repository's git config alone", () => {
    // Regression: the suite runs from inside git hooks, where GIT_DIR points
    // at the real repository. Unscrubbed, the throwaway repo's `git init` and
    // `git config` rewrote the real config — `core.bare` became true and the
    // commit identity was replaced, which then broke the pre-push hook.
    expect(realRepoConfig()).toBe(realRepoConfigBefore);
  });

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
