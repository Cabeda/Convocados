import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Gate 1 was defined in three places that disagreed: the pre-push hook, this
 * repo's `scripts/factory/gate.sh`, and CI. "Gate 1 passed" therefore meant
 * something different depending on who ran it, and the fix in AGENTS.md was to
 * ask the agent to *remember* the difference — which is the failure mode a gate
 * exists to remove.
 *
 * This pins the cheap set to one meaning. It fails when a check is added to one
 * runner and not the other, when a *generator* is wired where a *check* belongs,
 * and when a threshold is duplicated as a literal instead of living in
 * package.json.
 */
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf-8");

const HOOK = "scripts/pre-push.sh";
const FACTORY_GATE = "scripts/factory/gate.sh";

/**
 * The cheap checks, and the command that satisfies each. Everything here runs in
 * seconds; the suite and the Android builds are deliberately excluded.
 */
const CHEAP_GATES: Array<{ name: string; pattern: RegExp }> = [
  { name: "lint", pattern: /pnpm lint\b/ },
  { name: "typecheck", pattern: /pnpm typecheck\b/ },
  { name: "tests with coverage", pattern: /vitest run --coverage/ },
  { name: "route coverage", pattern: /route-coverage\.sh|test:route-coverage/ },
  { name: "feature parity", pattern: /check:feature-parity/ },
  { name: "generated api client", pattern: /check:api-client/ },
  { name: "play listing", pattern: /check:play-listing\b/ },
  { name: "play screenshots", pattern: /check:play-screenshots\b/ },
  { name: "dependency audit", pattern: /pnpm audit\b/ },
];

describe("the cheap gates run in both Gate 1 runners", () => {
  for (const { name, pattern } of CHEAP_GATES) {
    it(`${name} runs in the pre-push hook`, () => {
      expect(read(HOOK)).toMatch(pattern);
    });

    it(`${name} runs in scripts/factory/gate.sh`, () => {
      expect(read(FACTORY_GATE)).toMatch(pattern);
    });
  }
});

describe("a gate checks, it does not repair", () => {
  // The generator rewrote the file it was checking and exited 0, so the gate
  // could never report that the committed doc was stale. A *message* naming the
  // generator is the fix instruction and is expected; an *invocation* is the bug.
  const INVOCATION = /^\s*(?:run_gate\s+\S+\s+)?(pnpm|npx|tsx|node)\s+.*(?:sync:feature-parity-docs|generate-feature-parity-docs)/m;

  it("the pre-push hook does not invoke the generator", () => {
    expect(read(HOOK)).not.toMatch(INVOCATION);
  });

  it("scripts/factory/gate.sh does not invoke the generator", () => {
    expect(read(FACTORY_GATE)).not.toMatch(INVOCATION);
  });
});

describe("the test gate reads vitest's exit status", () => {
  // `#!/bin/sh` with no pipefail: in `if ! pnpm vitest … | tee … | tail`, `$?`
  // is tail's, so the failure branch is dead and a red suite still pushes.
  it("does not pipe the suite inside the `if` condition", () => {
    expect(read(HOOK)).not.toMatch(/^\s*if\s+!?\s*pnpm vitest run[^\n]*\|/m);
  });

  it("captures the suite's output in a per-run temp file", () => {
    expect(read(HOOK)).toMatch(/tests_log="\$\(mktemp /);
    expect(read(HOOK)).not.toMatch(/\/tmp\/pre-push-tests\.log/);
  });
});

describe("thresholds live in one place", () => {
  it("the lint warning cap is on the package.json script, so CI enforces it too", () => {
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(scripts.lint).toMatch(/--max-warnings\s+\d+/);
  });

  it("no runner restates the cap as its own literal", () => {
    // It was `--max-warnings 259` in both runners against a real count of 187,
    // and CI had no cap at all — three statements of one number, two of them
    // wrong. A literal here means they have diverged again.
    expect(read(HOOK)).not.toMatch(/--max-warnings/);
    expect(read(FACTORY_GATE)).not.toMatch(/--max-warnings/);
  });
});
