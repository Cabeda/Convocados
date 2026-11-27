# Closing the four Factory gaps

A proposal, not a decision. Measured on 2026-11-27; re-measure before building, because every
number below is a snapshot and the repo moves.

The loop itself is recorded in [`README.md`](./README.md). This document starts from what the
loop *does*, checked against the repository rather than against the design notes, and proposes
the smallest set of Changes that closes what does not work.

## What was measured

```
gh issue list --state open --json labels     # 98 open issues
gh pr list --state open --json labels        # open Changes
rg -l "explorer-|sentinel" .github/workflows # no file
```

| Fact | Value |
|---|---|
| Issues labelled `factory:explored` | 48 |
| Issues labelled `factory:blocked` | 12 |
| Issues labelled `ready-for-agent` | 0 |
| Open Changes labelled `factory:review` | ~23 |
| Workflows referencing `explorer-*` or `sentinel` | 0 |

## The order is not the obvious one

Two facts decide it, and they point the same way:

1. **Work is found faster than it is offered.** 48 Issues are explored and unqueued while the
   queue is empty. An Explorer run added tomorrow makes that pile 52, not 4 merges.
2. **Merging is the ceiling, not implementing.** ~23 Changes wait in `factory:review`. The
   Sweeper deliberately does not treat a green, up-to-date Change as stuck — "waiting is not
   stuck" — so nothing at all moves that ground.

So: fix the demand side (what gets offered, and how cheaply it is decided), then recover silent
failures, then add supply. Discovery is last, and on a leash.

## 1. Admission control, and a Proposer that ranks the pile

**Gap.** Promotion from `factory:explored` to `ready-for-agent` is 100% human and currently
unscheduled, so 48 evidenced Issues are invisible until someone re-reads them all.

**Proposal.** A new *primary* agent, `proposer`, whose only authority is **one label and one
comment**. It reads open `factory:explored` Issues, dedupes them against open Changes, and marks
at most **three per day** as `factory:proposed`, each with the paragraph Cabeda needs to decide:

- the one-sentence answer to *does this let people play more, with less administration?*
- the acceptance criterion, and the files it expects to touch,
- the size band (S / M / >cap), and what it blocks or is blocked by.

`ready-for-agent` stays Cabeda's alone — the proposer cannot queue anything, exactly as an
Explorer cannot.

**Admission control is the point.** If open `factory:review` Changes are at or above 12, the
proposer proposes **nothing**, and says so in its run log. That is a one-line rule and it
enforces the third pillar: the administration cannot grow behind the human's back.

**Files.** `.opencode/agents/proposer.md`, `.github/workflows/factory-propose.yml`,
`scripts/factory/propose.ts` (ranking and dedupe as pure functions, the shape `attempt.ts` and
`automerge-run.ts` already set), `src/test/factory-propose.test.ts`.

**Cost.** One run a day, ~60 steps, no edits, no pushes. `FACTORY_PAUSED` respected.

## 2. A daily merge pack — the ceiling, made cheap to clear

**Gap.** ~23 green Changes compete for one human's attention, and nothing orders them.

**Proposal.** A **script, not an agent** — the same reasoning as `automerge-run.ts`: a queue
order must be reproducible, and a list is not a judgement. `factory-merge-pack.yml` runs once a
day and writes one comment (an Issue updated in place, never a new one each day):

| Change | Issue | Age | CI | Mergeable | Size | Hard-block? | Coverage Δ |
|---|---|---|---|---|---|---|---|

- **Hard-block** is derived from changed paths, not opinion: migrations, auth/token handling,
  the scheduler, workflows, and any coverage-threshold edit get a flag, because those are the
  Changes the Reviewer may only report on.
- Sorted by *unblocks most first* (Changes that close a `factory:blocked` Issue or unstick
  another Change), then age. The pack is read top-down, and the pass takes minutes.

It **does not** merge, approve, label, or comment on the Changes themselves.

**Deferred, deliberately:** a *wave builder* that batches Changes Cabeda marks `factory:wave-ok`
into one integration PR. That is real merge mechanics and it is only worth building if the pack
shows the queue still growing a week after it lands. The AGENTS.md wave rule already describes
the shape; nothing here needs it yet.

**Files.** `scripts/factory/merge-pack.ts`, `.github/workflows/factory-merge-pack.yml`,
`src/test/factory-merge-pack.test.ts`.

## 3. A review backstop for the Changes the Reviewer cannot reach

**Gap.** The Reviewer runs on `pull_request`, so it never sees a Dependabot Change, a fork, a
draft, or any Change opened before its workflow existed. A green fork PR gets nobody's attention
at all — `README.md` says so.

**Proposal.** `factory-review-pending.yml` on a schedule, where secrets *are* available. First
step is a `gh pr list` filter for open, non-draft Changes with no Reviewer comment; if that list
is empty the job **exits before an agent starts**, so the steady-state cost is one API call.
Otherwise it runs the existing `reviewer` agent over that list. For a fork, the prompt gains one
line: comment, never push — the branch is not ours.

**Files.** `.github/workflows/factory-reviewer.yml` (new schedule trigger + early exit), one
line in `.opencode/agents/reviewer.md` for the fork case.

**Cost.** Twice daily; near-zero while the list is empty, which it should be most days.

## 4. A post-merge watcher, so "merged" stops meaning "assumed live"

**Gap.** `release.yml` gates on `conclusion == 'success'` for main's CI run. A red run is skipped
**silently**: the Change is merged, nothing deployed, nobody told. `release.yml` also never
asserts the deployed artifact answers or reports the new version. The Sentinel exists to say so
and has no trigger — so the signal is missing, not the opinion.

**Proposal.** `main-ci-watch.yml`, triggered by `workflow_run` on `CI` for `main`, no agent:

- if the run is red, or `release.yml` did not run to success, file **one** incident Issue
  (`factory:sentinel`) with the failed job names, the head SHA, the last tag, and the version
  actually served in production;
- if the release succeeded, assert the served version equals the tag's version, and say nothing
  when it does. Silence is the healthy state. `/api/health` carries no version today, so this
  item adds one field, baked at build from `package.json` — that is the only product-code edit in
  this proposal.

No remediation, no retry, no agent — the same authority ceiling ADR 0045 sets for the Sentinel.

**Files.** `.github/workflows/main-ci-watch.yml`, `scripts/factory/deploy-verify.ts`,
`src/pages/api/health.ts` (+`version`), `src/test/deploy-verify.test.ts`.

## 5. Discovery, on a leash

**Gap.** `explorer-{design,bugs,security,performance}.md` and `sentinel.md` exist with no
trigger, so "Explorers file Issues" is documentation, not behaviour. The one Explorer that
matters most (Performance) also cannot act until a Baseline is committed (ADR 0047).

**Proposal.** `factory-explore.yml`, one job per focus, staggered weekly: bugs Monday, security
Tuesday (plus the existing dependency event), design monthly. Performance stays **off** until
the ADR 0047 Baseline is committed — an Explorer measuring against nothing produces opinions.

Explorers are read-only, so the workflow publishes the Exploration itself: a step after the
agent run commits `docs/explorations/<focus>/<date>.md`. That keeps the memory honest without
widening the agent's authority.

**Turned on only when item 1 has proven it can drain:** the switch is a repo variable, armed when
`factory:proposed` has held under 5 for two consecutive days. Until then the workflow exists and
does not fire, so supply cannot outrun promotion.

**Files.** `.github/workflows/factory-explore.yml`, `FACTORY_EXPLORERS` repo variable,
`.opencode/agents/explorer-*.md` untouched.

## Sequencing

| # | Item | Closes | Lands as | Enable when |
|---|---|---|---|---|
| 1 | Proposer + admission control | queue empty, 48 invisible | 1 Change | immediately |
| 2 | Merge pack | merge ceiling | 1 Change | immediately |
| 3 | Review backstop | Reviewer reach | 1 Change | after 2 |
| 4 | Post-merge watcher | merged ≠ live | 1 Change | after 1 |
| 5 | Discovery cron | roles with no trigger | 1 Change, variable-gated | `factory:proposed` < 5 for 2 days |

Each is one Change under the 400-line / 20-file cap, test-first, with its own Issue. Items 1 and 2
are the ones worth building first: they are the pair that turns 48 findings and 23 Changes into a
week of decisions rather than a backlog.

## What this deliberately does not do

- No machine merge, no machine `ready-for-agent`, no machine label beyond `factory:proposed` and
  `factory:sentinel`.
- No remediation: the watcher files and stops. ADR 0045 stands.
- No new agent may edit code except the roles that already do.
- No metric work before a Baseline. ADR 0047 stands.
- No parallel PR review: item 3 makes the Reviewer *reach* more Changes, it does not make it
  review faster.
