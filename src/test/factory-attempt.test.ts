/**
 * The Attempt ledger is the only thing that stops the Reviewer and the Fixer
 * arguing forever: `scripts/factory/attempt.ts` writes one comment per round and
 * `next-fix.ts` counts them. A write that fails silently reports a round GitHub
 * never recorded, so the count stays at zero, the same Change is picked again,
 * and the three-round handoff to Cabeda can never fire.
 *
 * Reproduced 2026-11-27 on PR #1873: the ledger logged "Attempt 1 recorded
 * (budget 3)" at 13:18 and the Change still carried zero attempt comments.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const source = () => readFileSync(join(repoRoot, "scripts/factory/attempt.ts"), "utf8");

describe("recording an Attempt", () => {
  it("does not write through the helper that swallows errors", () => {
    // `gh()` returns "" on failure, which is right for the kind probe and wrong
    // for the one write this script exists to make.
    expect(source()).toMatch(/execFileSync\(\s*"gh",\s*\[kind, "comment"/);
    expect(source()).not.toMatch(/^\s*gh\(\[kind, "comment"/m);
  });
});
