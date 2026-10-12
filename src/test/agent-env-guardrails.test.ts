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
 * reintroduces the tax. Assertions pin behaviour, not prose: string-matching a
 * claim in a comment would have certified the bootstrap bug this suite caught.
 */
describe("agent environment guardrails", () => {
  it("unions the dex task ledger on merge, and no attribute makes a false promise", async () => {
    const gitattributes = await read(".gitattributes");

    // .dex/tasks.jsonl is one JSON object per line: a union merge keeps every
    // line from both sides, so integration branches stop conflicting on it.
    expect(gitattributes).toMatch(/^\.dex\/tasks\.jsonl\s+merge=union$/m);

    // merge=ours is inert unless a driver is registered in git config (which
    // cannot be committed), so it would conflict anyway while looking like it
    // solves something. The file is derived state: document "take either side
    // wholesale" instead of shipping a no-op attribute.
    expect(gitattributes).not.toMatch(/\.dex\/sync-state\.json\s+merge=ours/);
  });

  it("keeps every task id unique after a union merge", async () => {
    const ledger = await read(".dex/tasks.jsonl");
    const ids = ledger
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line).id as string);

    // A union merge splices lines from both branches without conflict — which
    // is silent when both sides edited the *same* task (mutable completed/
    // updated_at fields): two lines, same id, divergent state. The CI failure
    // names the reconcile command.
    expect(
      ids,
      "duplicate task id in .dex/tasks.jsonl — run `node scripts/dex-dedupe.mjs` and commit",
    ).toHaveLength(new Set(ids).size);
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
    // missing .bin links and gitignored Android env files, and the
    // ungenerated Prisma client the script's own header lists as cost 3.
    expect(script).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(script).toMatch(/better-sqlite3/);
    expect(script).toMatch(/\.bin/);
    expect(script).toContain("google-services.json");
    expect(script).toContain("local.properties");
    // The root .env is gitignored too and DATABASE_URL gates prisma generate,
    // so the Prisma cost below cannot be paid without it.
    expect(script).toContain('if [ -f "$SOURCE/.env" ] && [ ! -f .env ]; then');
    expect(script).toContain('cp "$SOURCE/.env" .env');
    expect(script).toContain("pnpm db:generate");
    expect(script).toMatch(/if \[ ! -d src\/lib\/__generated__\/prisma \]/);

    // The native build must land in the store directory Node resolves —
    // three dirnames up from .../better-sqlite3@X/node_modules/better-sqlite3/
    // build reach the version directory X. One dirname short silently copies
    // into node_modules/ itself and the cost stays unpaid.
    expect(script).toMatch(
      /version_dir=\$\(basename "\$\(dirname "\$\(dirname "\$\(dirname/,
    );

    // Rerun safety comes from existence guards around each copy, not from
    // set -e (which only stops on error): a script that wiped its target
    // first would pass a set -e assertion.
    expect(script).toMatch(/\[ ! -d "\$target" \]/);
    expect(script).toMatch(/\[ -e "node_modules\/\.bin\/\$name" \] \|\|/);
    expect(script).toMatch(/\[ ! -f "\$target_dir\/\$envfile" \]/);

    // Fail-loud: a partial copy must abort, not continue to the next cost.
    expect(script).toMatch(/set -e/);
  });

  it("points AGENTS.md at the bootstrap script, the coding standards, and the ledger reconcile", async () => {
    const agents = await read("AGENTS.md");

    expect(agents).toContain("scripts/worktree-bootstrap.sh");
    expect(agents).toContain("CODING_STANDARDS.md");
    expect(agents).toContain("scripts/dex-dedupe.mjs");
  });

  it("keeps the reviewer checklist's drift command runnable on this Prisma version", async () => {
    const standards = await read("CODING_STANDARDS.md");

    // The checklist cites commands a reviewer runs verbatim; the old
    // --to-schema-datamodel flag was removed and errors out — a dead
    // checklist entry silently skips the drift check.
    expect(standards).toContain(
      "--to-schema prisma/schema.prisma --exit-code",
    );
    expect(standards).not.toContain("--to-schema-datamodel prisma");
  });

  it("pins the AGENTS.md pointer to the extracted development guide", async () => {
    // The prune moved reference blocks out of AGENTS.md behind this pointer.
    // A dropped pointer or a moved/deleted guide silently strands every future
    // agent at a dead link — the class this suite exists to catch.
    const agents = await read("AGENTS.md");
    expect(agents).toContain("docs/development-guide.md");

    const guidePath = "docs/development-guide.md";
    expect(existsSync(join(root, guidePath))).toBe(true);
    const guide = await read(guidePath);
    // The moved sections actually landed in the guide.
    expect(guide).toContain("## Event Lifecycle & Game Phases");
    expect(guide).toContain("## Common Patterns");
    // The production-inspection pointer names a real runbook; that file and its
    // own existence check ship in the prod-inspection Change.
    expect(agents).toContain("docs/runbooks/production-inspection.md");
  });
});
