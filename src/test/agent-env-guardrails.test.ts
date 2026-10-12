import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function read(rel: string): Promise<string> {
  return readFile(join(root, rel), "utf8");
}

/**
 * The agent-environment guardrails this Change introduced: every implementer
 * run on a fresh worktree used to rediscover the same three costs by hand.
 * These guardrails exist to stop that rediscovery, so the files must exist and
 * stay wired — a deleted script or a dropped .gitattributes entry silently
 * reintroduces the tax.
 */
describe("agent environment guardrails", () => {
  it("unions the dex task ledger on merge so integration branches stop conflicting", async () => {
    const gitattributes = await read(".gitattributes");

    // .dex/tasks.jsonl is append-only JSONL: a union merge keeps every line
    // from both sides with no conflict. sync-state.json is a single JSON
    // object that is derived state — one side must win wholesale or the file
    // stops parsing.
    expect(gitattributes).toMatch(/^\.dex\/tasks\.jsonl\s+merge=union$/m);
    expect(gitattributes).toMatch(/^\.dex\/sync-state\.json\s+merge=ours$/m);
  });

  it("ships an executable worktree bootstrap script covering every rediscovered cost", async () => {
    const scriptPath = "scripts/worktree-bootstrap.sh";
    expect(existsSync(join(root, scriptPath))).toBe(true);
    // Executable bit matters: implementers copy-paste the one-liner from
    // AGENTS.md and never think about chmod.
    const mode = statSync(join(root, scriptPath)).mode;
    expect(mode & 0o111).not.toBe(0);

    const script = await read(scriptPath);

    // The three taxes, verbatim: half-installed node_modules on a fresh
    // worktree (native better-sqlite3 build fails on this machine), the
    // missing .bin links, and the gitignored Android env files.
    expect(script).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(script).toMatch(/better-sqlite3/);
    expect(script).toMatch(/\.bin/);
    expect(script).toContain("google-services.json");
    expect(script).toContain("local.properties");
    // It must be idempotent — implementers rerun it after each failed gate.
    expect(script).toMatch(/set -e/);
  });

  it("points AGENTS.md at the bootstrap script and the coding standards", async () => {
    const agents = await read("AGENTS.md");

    expect(agents).toContain("scripts/worktree-bootstrap.sh");
    expect(agents).toContain("CODING_STANDARDS.md");
  });
});
