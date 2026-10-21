#!/usr/bin/env node
// Reconcile .dex/tasks.jsonl after a merge=union splice duplicated a task.
//
// A union merge keeps every line from both sides without conflict, which is
// silent when both branches edited the *same* task (mutable completed/
// updated_at fields): two lines, one id, divergent state. This keeps the
// line with the newest updated_at per id and rewrites the ledger.
//
// It also catches the ledger being moved aside. `git stash push -- .dex` takes
// the tracker out of the working tree, and dex reads the working tree — so the
// task list disappears while the tasks sit in the stash. The tasks HEAD has
// and the working tree does not, but a stash holds, are exactly that.
//
// Usage: node scripts/dex-dedupe.mjs [--check]
//   --check  exit 1 if duplicates exist, write nothing (what CI needs)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const path = new URL("../.dex/tasks.jsonl", import.meta.url);
const checkOnly = process.argv.includes("--check");

/** Run a git command in the repo, or null when it cannot answer. */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** The task ids in a ledger's text. */
function taskIds(text) {
  const ids = new Set();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      ids.add(JSON.parse(line).id);
    } catch {
      // A malformed line is the dedupe's business, not this check's.
    }
  }
  return ids;
}

const lines = readFileSync(path, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0);

const keep = new Map();
for (const line of lines) {
  const task = JSON.parse(line);
  const previous = keep.get(task.id);
  if (!previous || String(task.updated_at ?? "") >= String(previous.updated_at ?? "")) {
    keep.set(task.id, line);
  }
}

// ── The ledger is newer in a stash ───────────────────────────────────────────
// `git stash push -- .dex` takes the tracker out of the working tree, and dex
// reads the working tree — so a task created after the stash is invisible
// until the stash is popped. The tasks HEAD has and the working tree does not
// are the symptom; a stash that holds them is the cause.
const workingTreeIds = new Set(keep.keys());
for (const stash of (git(["stash", "list", "--format=%gd"]) ?? "").split("\n").filter(Boolean)) {
  const stashed = git(["show", `${stash}:.dex/tasks.jsonl`]);
  if (stashed === null) continue;
  const onlyInStash = [...taskIds(stashed)].filter((id) => !workingTreeIds.has(id));
  if (onlyInStash.length > 0) {
    console.error(
      `dex-dedupe: ${stash} holds ${onlyInStash.length} task(s) the working tree does not: ${onlyInStash.join(", ")} — the ledger is behind (\`git stash pop ${stash}\`). dex reads the working tree, so these tasks are invisible until it is restored.`,
    );
    process.exit(1);
  }
}

const duplicates = lines.length - keep.size;
if (duplicates === 0) {
  console.log("dex-dedupe: ledger already unique");
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `dex-dedupe: ${duplicates} duplicate task line(s) in .dex/tasks.jsonl — run \`node scripts/dex-dedupe.mjs\` and commit`,
  );
  process.exit(1);
}

writeFileSync(path, [...keep.values()].join("\n") + "\n");
console.log(`dex-dedupe: removed ${duplicates} duplicate line(s), kept newest updated_at per id`);
