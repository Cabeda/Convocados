# The Delivery Factory

Automation that turns Issues into ready-to-prod Changes, and watches for work nobody has
asked for. It never merges.

The contract lives in [`AGENTS.md`](../../AGENTS.md) (Mission, Core Principles, Merge
Authority, The Delivery Factory). The vocabulary lives in
[`CONTEXT.md`](./CONTEXT.md). Decisions live in `docs/adr/0042`–`0048`.

## The loop

```
ready-for-agent Issue
  → Factory: branch from origin/main, work in an isolated workspace
  → Gate 1 (local): lint · typecheck · vitest --coverage · route-coverage
                     feature-parity · Gradle assembleDebug :app + :wear · audit
  → push factory/<issue> → open Change
  → Gate 2 (GitHub CI)         → red: Repairer, fresh session, same branch
  → Reviewer: independent review against Mission + Core Principles
  → Handoff: label factory:review, comment the summary and transcript
  → CABEDA. Always Cabeda.
```

Nothing above is "done". Every path ends at a human or at **Blocked**.

## Roles

Each role is a **primary agent** in `.opencode/agents/` — primary, because the action's
`agent:` input only accepts primary agents — selected per workflow.

| Agent | Trigger | May | May not |
|---|---|---|---|
| `factory` | Issue labelled `ready-for-agent` | edit, commit, push `factory/*`, open Change | merge, release, label, touch a human branch |
| `repairer` | Gate red | same as factory, budget 3 | exceed its Attempt budget |
| `reviewer` | `pull_request` opened/synchronize | comment, push fixes to `factory/*` | approve; edit a human branch |
| `explorer-performance` | schedule (nightly) | read, run committed benchmarks, file Issues | edit code, label Issues |
| `explorer-bugs` | schedule (weekly) | read, file Issues | edit code, label Issues |
| `explorer-security` | dependency event + schedule | read, file Issues | edit code, label Issues |
| `explorer-design` | schedule (monthly) | read, screenshot, file Issues | edit code, label Issues |
| `sentinel` | schedule (15 min) | read Fly + `/api/health`, file incident, page | **change anything in production** |

`repairer` is the same agent as `factory` with a lower `steps` budget. Separate file,
identical permissions, so a repair cannot quietly inherit more authority than an
implementation.

## Files

```
.opencode/agents/*.md          # roles: frontmatter = model, steps, permission
.opencode/prompts/*.txt        # system prompts, referenced by {file:...}
.opencode/skills/*/SKILL.md    # gates, metric integrity, issue contract
.github/workflows/factory-*.yml
scripts/factory/gate.sh        # Gate 1, sequential, the single source of truth
scripts/factory/attempt.ts     # Attempt counter, read from labels/comments
docs/explorations/<focus>/     # Explorer memory
```

The gate lives in a script, not in a prompt. A prompt can be ignored; a script that exits
non-zero cannot. Every rule about measurements lives in `AGENTS.md` and is enforced by that
script, and the two must be changed in the same PR.

## Enforcement

Permissions are `deny`-first, last-match-wins, in the agent frontmatter. See
ADR 0046 for the reasoning and ADR 0048 for the token.

```yaml
permission:
  question: deny              # no human is attached; asking stalls until timeout
  external_directory: deny    # stay inside this checkout
  doom_loop: deny             # 3 identical tool calls = stuck; this is the loop guard
  task: { "*": deny }         # no delegation, so read-only really is read-only
  edit:
    "*": allow
    ".github/workflows/**": deny
    ".github/CODEOWNERS": deny
  bash:
    "*": allow
    "gh pr merge*": deny
    "git push --no-verify*": deny
    "git push origin main*": deny
    "git push origin factory/*": allow
```

Non-negotiable workflow settings: `share: false` (defaults to `true` on public repos),
`use_github_token: true`, and on every `schedule` workflow an explicit
`contents: write` + `pull-requests: write` + `issues: write`.

## States

Three labels, no hidden memory. A process may die between any two of these and the next run
reads the truth from GitHub.

| Label | Meaning |
|---|---|
| `ready-for-agent` | Queued. **Only Cabeda applies it.** |
| `factory:review` | Awaiting Cabeda. The Factory's only success state. |
| `factory:blocked` | Budget spent or target unreachable. Waits for a human. |
| `factory:explored` | Filed by an Explorer. **Not** queued. |

Queue order: `dex:priority-1` → `-2` → `-3`, oldest first within each. A Claim is a comment
on the Issue; the next run reads claims before selecting, and a stale claim is reclaimed
after its run's own timeout.

Budgets: 3 Attempts per Gate, 6 per Issue, 500k tokens per Issue, 5M per day. `steps` in
the agent frontmatter caps in-run iteration; `scripts/factory/attempt.ts` caps it across
runs. Spending a Budget ends the run as **Blocked** with evidence, never as a shrug.

`FACTORY_PAUSED=true` as a repository variable stops every entry point. No machine sets or
clears it.

## Build order

Each step is independently shippable and ends with something you can watch work.

1. **Constitution** — done: `AGENTS.md` Mission + Core Principle 6 + Merge Authority +
   factory contract, `CONTEXT-MAP.md`, `docs/factory/CONTEXT.md`, ADRs 0042–0048.
2. **Identity and labels** — create the `convocados-factory[bot]` App with least privilege
   (no approve, no merge, no workflows) and store its token as a secret; create the four
   labels; split `CODEOWNERS` so ownership and the preview allowlist are separate. Nothing
   runs yet. *First thing to verify: a fresh checkout with no global config discovers
   `.opencode/agents/` and honours its `permission` block.*
3. **One manual Change** — `workflow_dispatch`, `agent: factory`, on a deliberately
   worthless `docs:` Issue. Watch the whole run. This is where the dumb bugs surface.
4. **Gate 1 for real** — `scripts/factory/gate.sh`, sequential, with the 400-line/20-file
   cap wired to split-and-hand-back.
5. **Triggers** — `issues: [labeled]` gated on the label, `pull_request` for the Reviewer,
   `check_suite: completed` for the Repairer, and a 15-minute janitor for stale claims,
   orphan worktrees and stale states.
6. **Reviewer** — the step that turns green into ready: Mission and Core Principles as
   criteria, Hard Block categories that only report, push-to-`factory/*` only.
7. **Baselines** — commit k6 scenarios and thresholds, Lighthouse budgets. No agent touches
   a metric until this lands. ADR 0047.
8. **Explorers** — Performance first (it is the only one with a Baseline), then Bugs,
   Security, Design.
9. **Sentinel** — last. It is the only role that looks at production, and until steps 1–8
   work it would only be generating noise.

Steps 2 and 3 are where the risk is, and they are deliberately cheap.

## What this deliberately does not do

- No resident daemon. Every role is an event or a cron, and GitHub holds all the state.
- No remediation. The Sentinel tells a human; it never scales, restarts, or rolls back.
  ADR 0045.
- No machine-written dex tasks. dex is a local CLI, absent from the runner. ADR 0043.
- No metric work before a committed Baseline. ADR 0047.
