/**
 * Attempt counter — the Budget that survives a process dying.
 *
 * An Attempt is one repair cycle against a failing Gate. `steps` in the agent
 * frontmatter caps iteration *inside* a run; this caps it *across* runs, because
 * the runtime ledger is GitHub, not the agent (ADR 0043). There is no hidden
 * memory: the count is derived from what a restarted process can read — the
 * Attempt comments on the Change, and the `factory:blocked` label.
 *
 * Usage:
 *   node scripts/factory/attempt.ts <pr|issue> [gate]        # print the count
 *   node scripts/factory/attempt.ts <pr|issue> [gate] --set spent
 *
 * Exits 1 when the budget for that Gate is already spent, so a caller can gate
 * on it with `&&`.
 */
import { execFileSync } from "node:child_process";

const GATE_ATTEMPTS = 3;
const ISSUE_ATTEMPTS = 6;
const BLOCKED_LABEL = "factory:blocked";
const ATTEMPT_MARKER = "factory: attempt";

function gh(args: string[]): string {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

/**
 * A bare number is ambiguous: GitHub numbers Issues and PRs in one sequence, and
 * `gh issue view <pr>` succeeds for a PR because the Issues API includes them.
 * So probe PR first — only a PR ref answers to both.
 */
function resolveKind(ref: string): "issue" | "pr" {
  if (ref.startsWith("#")) return "issue";
  if (!/^\d+$/.test(ref)) return "pr";
  for (const kind of ["pr", "issue"] as const) {
    if (gh([kind, "view", ref, "--json", "number", "--repo", "Cabeda/Convocados"]).trim()) return kind;
  }
  console.error(`cannot resolve ${ref} to a PR or an Issue — refusing to guess the Attempt budget`);
  process.exit(2);
}

function attemptsFor(ref: string, gate: string | undefined): number {
  const kind = resolveKind(ref);
  const raw = gh([kind, "view", ref, "--json", "comments,labels", "--repo", "Cabeda/Convocados"]);
  if (!raw) return 0;

  const data = (() => {
    try {
      return JSON.parse(raw) as {
        comments?: Array<{ body?: string }>;
        labels?: Array<{ name?: string }>;
      };
    } catch {
      // `gh` can answer with help text or an error on stdout when auth is
      // broken or the ref is wrong. Failing open would hand out free Attempts,
      // so this is a hard error: a run that cannot read the ledger must stop.
      console.error(`cannot read the Attempt ledger for ${ref}: unparseable gh output`);
      process.exit(2);
    }
  })();

  const blocked = (data.labels ?? []).some((l) => l.name === BLOCKED_LABEL);
  const comments = data.comments ?? [];
  const marker = gate ? `${ATTEMPT_MARKER} <${gate}>` : ATTEMPT_MARKER;

  return comments.filter((c) => (c.body ?? "").includes(marker)).length + (blocked ? 1 : 0);
}

const [ref, gate, ...flags] = process.argv.slice(2);
if (!ref) {
  console.error("usage: attempt.ts <pr|issue> [gate] [--set spent]");
  process.exit(2);
}

const kind = resolveKind(ref);
const spent = attemptsFor(ref, gate);
const budget = gate ? GATE_ATTEMPTS : ISSUE_ATTEMPTS;
const scope = gate ? `Gate ${gate}` : `${kind === "pr" ? "Change" : "Issue"} ${ref}`;
const spentAlready = flags.includes("--set") ? spent + 1 : spent;

if (flags.includes("--set")) {
  const body = gate
    ? `${ATTEMPT_MARKER} <${gate}> (${spent + 1}/${budget}) — see Gate log for the failure this Attempt addresses.`
    : `${ATTEMPT_MARKER} (${spent + 1}/${budget})`;
  gh([kind, "comment", ref, "--body", body, "--repo", "Cabeda/Convocados"]);
  console.log(`${scope}: Attempt ${spent + 1} recorded (budget ${budget})`);
}

console.log(`${scope}: ${spentAlready} of ${budget} Attempts used${spentAlready >= budget ? " — budget spent" : ""}`);
process.exit(spentAlready >= budget ? 1 : 0);
