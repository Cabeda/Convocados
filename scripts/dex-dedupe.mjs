#!/usr/bin/env node
// Reconcile .dex/tasks.jsonl after a merge=union splice duplicated a task.
//
// A union merge keeps every line from both sides without conflict, which is
// silent when both branches edited the *same* task (mutable completed/
// updated_at fields): two lines, one id, divergent state. This keeps the
// line with the newest updated_at per id and rewrites the ledger.
//
// Usage: node scripts/dex-dedupe.mjs [--check]
//   --check  exit 1 if duplicates exist, write nothing (what CI needs)
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../.dex/tasks.jsonl", import.meta.url);
const checkOnly = process.argv.includes("--check");

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
