# Nightshift — the local auto-merge loop

Nightshift is a **local** supervisor (`scripts/nightshift/run.sh`) that turns
`ready-for-agent` Issues into merged Changes while you sleep. It is the Delivery
Factory's loop with one deliberate difference: **it merges.**

That difference is the whole risk. On this repository **merging deploys**:
`.github/workflows/release.yml` fires on a green `main` and bumps the version,
deploys Fly, publishes the Android build to the Play internal track, and deploys
the scheduler. An unattended merge is an unattended production deploy. Nightshift
exists only because that trade was made explicitly; treat every guard below as
load-bearing.

## The loop

```
ready-for-agent Issue
  → select (skip blocked / claimed / already-PR'd)
  → worker: isolated git worktree, opencode run, TDD
  → Gate 1 (scripts/factory/gate.sh)
  → push factory/<n>-<slug>, open Change
  → poll Gate 2 (GitHub CI)
      red  → repair session (budget 3), same branch, fresh context
  → adversarial review session (different model)
  → decide-merge  (PURE predicates — no LLM)
  → serial merge lock → squash merge
  → post-merge canary: main CI + /api/health; on red, open auto-revert
  → repeat
```

## Why the merge decision is a script, not an agent

`scripts/nightshift/merge-eligibility.ts` is pure: facts in, verdict out, no I/O.
The same argument as `scripts/factory/automerge-eligibility.ts` — an LLM's "is
this mergeable?" is unauditable and not reproducible. `merge.ts` only gathers
facts and acts on the verdict. The model chooses *what to build*; it never
chooses *whether the result may land*.

## The guards (all of them)

| # | Guard | Failure it prevents |
|---|---|---|
| 1 | All required checks present **and** `success`, named individually | A skipped gate hiding behind a green aggregate |
| 2 | Branch level with `main` (`commitsBehindBase == 0`) | #1256: a green run on a stale base did not reflect the base it landed on |
| 3 | `headSha === checksSha` | Merging a SHA that CI never saw (push after green) |
| 4 | No unresolved review threads | Merging over an open objection |
| 5 | A required approver, distinct from the author | Self-approval |
| 6 | Diff ≤ 400 lines / 20 files | Unreviewable Change |
| 7 | `coverageDelta >= 0` **and** thresholds not lowered | Cheating the coverage ratchet (Core Principle 5) |
| 8 | `mutationDelta >= 0` | Tests that pass without exercising |
| 9 | No hard-block path touched | Migrations, workflows, `CODEOWNERS`, auth, the loop itself |
| 10 | Labels: `factory:review` present, `factory:blocked` absent | Merging parked or unready work |
| 11 | Serial merge lock | Two green Changes colliding on `main` |
| 12 | Post-merge canary + auto-revert | A bad deploy reaching users with no backstop |

Guards 1–10 live in `merge-eligibility.ts` and are unit-tested in
`src/test/nightshift-merge-eligibility.test.ts`. Guards 11–12 live in `merge.ts`.

## Hard-block paths

Never auto-merged, regardless of how green: any new Prisma migration, any change
to `.github/workflows/**`, `.github/CODEOWNERS`, `AGENTS.md`, `scripts/factory/**`,
`scripts/nightshift/**`, or `docs/factory/**`. These are the categories where a
mistake is unrecoverable or where a machine would be editing its own
constitution. They route to a human.

## Budgets and the kill switch

- `FACTORY_PAUSED=true` (env or repo variable) stops everything at the top of
  every iteration.
- Per-issue: 3 repair Attempts, then `factory:blocked`.
- Per-night: a merges cap and a wall-clock stop (`NIGHTSHIFT_UNTIL`, default
  `07:00`) so the loop cannot run into the working day.
- A global token/attempt cap is enforced by the per-issue and per-night budgets.

## Threat model

- **Skip-permissions.** The worker runs `opencode run --dangerously-skip-permissions`.
  On your laptop that is your `.env`, `gh` token, `dev.db` and `~/.ssh` inside the
  model's blast radius. Run Nightshift in a sandbox (devcontainer) with a
  repo-scoped token and **no production secrets**. If you cannot sandbox it, do
  not run it unattended.
- **Prompt injection.** Repo content (issue bodies, code comments) is untrusted
  input to the model. The merge decision is not made by the model, and the worker
  agent keeps `webfetch: deny` and may not push except to `factory/*`, so an
  injected instruction cannot merge or exfiltrate via the agent's own network.
- **Self-modification.** The worker may not edit the workflows, `CODEOWNERS`,
  `AGENTS.md`, or the Nightshift scripts. Those paths are both denied in the agent
  permissions and hard-blocked in the merge decision.

## How to run

```bash
# one night, workers=3, stop at 07:00
NIGHTSHIFT_WORKERS=3 NIGHTSHIFT_UNTIL=07:00 bash scripts/nightshift/run.sh

# dry run: select and print, merge nothing
NIGHTSHIFT_DRY_RUN=1 bash scripts/nightshift/run.sh

# audit what it did
cat .nightshift/ledger.jsonl | jq -r '.event + " " + (.issue // .pr | tostring)'
```

## What this deliberately does not do

- No cloud daemon. It is a local `while true`; GitHub holds all the durable state.
- No auto-revert *deploy*. It opens a revert Change; if `main` is red, a human (or
  the loop on the next pass) lands it. It never force-pushes.
- No work before the gate. A worker that cannot run `gate.sh` green does not push.
