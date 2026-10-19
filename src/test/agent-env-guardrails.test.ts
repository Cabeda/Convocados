import { describe, it, expect } from "vitest";
import { existsSync, statSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
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

  it("keeps AGENTS.md to steps plus pointers by parking its reference blocks behind them", async () => {
    // AGENTS.md is pushed into every session's context on every turn, so a
    // reference block parked here is paid for by all of them (#1367). The line
    // budget is what stops the next "just add it here"; the moved prose must
    // land where the pointer sends the reader, or the pointer strands them.
    const agents = await read("AGENTS.md");
    const lines = agents.split("\n").length;
    expect(
      lines,
      `AGENTS.md is ${lines} lines — park reference behind docs/factory/ or docs/development-guide.md instead of growing it`,
    ).toBeLessThan(400);

    // The four blocks the decision moved no longer carry their reference prose…
    expect(agents).not.toContain("GATE 1 is the pre-push hook");
    expect(agents).not.toContain("warm caches, smaller inputs");
    expect(agents).not.toContain("dex ready");
    expect(agents).not.toContain("└── prisma/schema.prisma");

    // …while the pointers that send a reader to them do…
    expect(agents).toContain("docs/factory/README.md");
    expect(agents).toContain("docs/development-guide.md");

    // …and the prose actually landed there. A pointer to an empty shelf strands
    // the next reader exactly as a dropped pointer would.
    const factory = await read("docs/factory/README.md");
    expect(factory).toContain("GATE 1 is the pre-push hook");
    expect(factory).toMatch(/gate-parity\.test\.ts/);
    expect(factory).toMatch(/400 changed lines/);

    const guide = await read("docs/development-guide.md");
    expect(guide).toContain("dex ready");
    expect(guide).toContain("└── schema.prisma");
  });

  it("ships a read-only production query wrapper and stops citing the absent sqlite3 CLI", async () => {
    const scriptPath = "scripts/prod-query.sh";
    expect(existsSync(join(root, scriptPath))).toBe(true);
    // Executable: the runbooks call it directly.
    expect(statSync(join(root, scriptPath)).mode & 0o111).not.toBe(0);

    const script = await read(scriptPath);
    // Read-only is the point — a wrapper that can write to production is worse
    // than no wrapper.
    expect(script).toMatch(/better-sqlite3/);
    expect(script).toMatch(/readonly:\s*true/);
    expect(script).toMatch(/only SELECT/);

    // The runbook documents why the wrapper exists and where jobs execute.
    const runbook = await read("docs/runbooks/production-inspection.md");
    expect(runbook).toContain("scripts/prod-query.sh");
    expect(runbook).toMatch(/no `sqlite3` CLI/);
    // The failure list is `jobFailures` (retrying + dead-lettered), not the old
    // dead-letter-only name, and the runbook states what NotificationJob really
    // stores rather than claiming it persists a reason.
    expect(runbook).toContain("jobFailures");
    expect(runbook).not.toContain("deadLetterJobs");
    expect(runbook).toContain("DEAD_LETTER_TTL_DAYS");

    // Recovery runbooks run inside `fly ssh console` (the app may be stopped),
    // where the workstation-only wrapper is absent — so they must use the
    // in-machine driver, never scripts/prod-query.sh.
    for (const doc of [
      "docs/runbooks/full-recovery-from-zero.md",
      "docs/runbooks/point-in-time-recovery.md",
    ]) {
      expect(await read(doc)).not.toContain("scripts/prod-query.sh");
    }

    // The disaster-recovery verify step must not tell a reader to run the
    // binary the image does not have: `sqlite3 /data/db.sqlite` over fly ssh.
    const dr = await read("docs/disaster-recovery.md");
    expect(dr).not.toMatch(/^sqlite3 \/data\/db\.sqlite/m);
    expect(dr).toContain("better-sqlite3");
  });

  it("refuses a write through prod-query.sh without opening an SSH session", () => {
    // Behaviour, not prose: the read-only claim is only real if a write is
    // rejected before any remote connection. A stub `fly` proves no ssh ran.
    const stubDir = mkdtempSync(join(tmpdir(), "prod-query-stub-"));
    const marker = join(stubDir, "fly-was-called");
    const stubFly = join(stubDir, "fly");
    writeFileSync(stubFly, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
    chmodSync(stubFly, 0o755);

    let status = 0;
    try {
      execFileSync("sh", ["scripts/prod-query.sh", "DELETE FROM ScheduledJob"], {
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
        stdio: "pipe",
      });
    } catch (err) {
      status = (err as { status?: number }).status ?? -1;
    }

    expect(status).toBe(2);
    expect(existsSync(marker)).toBe(false);
  });

  it("runs the prod-query remote harness against a real DB, surviving the SSH boundary", () => {
    // The harness crosses an SSH boundary, so it must not depend on a
    // shell-escaped backslash: an earlier version used split(/\s+/), lost the
    // backslash in transit (`\s` became `s`), and rejected *every* query as if
    // it were a write. Recover the harness the way remote `sh` would receive it
    // — base64 through a stub `fly` — then execute it.
    const stubDir = mkdtempSync(join(tmpdir(), "prod-query-harness-"));
    const stubFly = join(stubDir, "fly");
    writeFileSync(
      stubFly,
      '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-C" ]; then printf \'%s\' "$2"; exit 0; fi; shift; done\n',
    );
    chmodSync(stubFly, 0o755);

    const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` };
    const payload = execFileSync("sh", ["scripts/prod-query.sh", "SELECT 1"], { env, encoding: "utf8" });
    const match = payload.match(/Buffer\.from\('([A-Za-z0-9+/=]+)'/);
    expect(match, `no harness in payload: ${payload}`).not.toBeNull();
    const harness = Buffer.from(match![1], "base64").toString("utf8");
    expect(harness).not.toContain("\\s");

    // Build a real DB and run the harness against it with the paths overridden.
    const dbPath = join(stubDir, "h.db");
    execFileSync(
      "node",
      [
        "-e",
        "const D=require('better-sqlite3');const db=new D(process.argv[1]);db.exec('CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1),(2);');db.close();",
        dbPath,
      ],
      { stdio: "pipe" },
    );
    const harnessEnv = { ...process.env, PROD_SQLITE_MODULE: "better-sqlite3", PROD_DB_PATH: dbPath };
    const withSql = (sql: string) =>
      harness.replace(
        /Buffer\.from\('[A-Za-z0-9+/=]+','base64'\)/,
        `Buffer.from('${Buffer.from(sql).toString("base64")}','base64')`,
      );

    // A SELECT runs and returns rows.
    const out = execFileSync("node", ["-e", withSql("SELECT n FROM t")], { env: harnessEnv, encoding: "utf8" });
    expect(out).toContain("2");

    // The remote guard still rejects a write (belt and braces with the local guard).
    let status = 0;
    try {
      execFileSync("node", ["-e", withSql("DELETE FROM t")], { env: harnessEnv, stdio: "pipe" });
    } catch (err) {
      status = (err as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });

  it("enforces a PR closing keyword and the dex ledger check in CI and pre-push", async () => {
    // A PR without a closing keyword leaves its issue open after the fix ships
    // (#1114/#1199); the template primes the keyword and CI enforces it.
    const template = await read(".github/PULL_REQUEST_TEMPLATE.md");
    expect(template).toMatch(/Closes #/);

    const ci = await read(".github/workflows/test.yml");
    // The check must be a job the aggregate gate depends on, or it never runs
    // as a required check.
    expect(ci).toMatch(/^\s{2}pr-links-issue:\s*$/m);
    expect(ci).toMatch(/^\s{2}dex-ledger:\s*$/m);
    expect(ci).toMatch(/node scripts\/dex-dedupe\.mjs --check/);
    // The closing-keyword logic is a tested module, not an inline snippet.
    expect(ci).toMatch(/node scripts\/check-pr-closing-keyword\.mjs/);
    // `labeled`/`unlabeled` re-run the job so the `no-issue` hatch can turn it
    // green; `edited` re-checks a body changed after green.
    expect(ci).toMatch(/types: \[[^\]]*\blabeled\b[^\]]*\]/);
    expect(ci).toMatch(/types: \[[^\]]*\bedited\b[^\]]*\]/);
    expect(ci).toMatch(/needs: \[[^\]]*\bdex-ledger\b[^\]]*\]/);
    expect(ci).toMatch(/needs: \[[^\]]*\bpr-links-issue\b[^\]]*\]/);

    // The ledger check also runs locally (warn-only; CI blocks): the hazard (a
    // union-merge splice of duplicate lines) happens during a rebase.
    const hook = await read("scripts/pre-push.sh");
    expect(hook).toMatch(/dex-dedupe\.mjs" --check/);
  });
});
