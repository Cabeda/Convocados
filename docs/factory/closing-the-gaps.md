# Closing the Factory's gaps

A proposal, not a decision. Measured on 2026-11-27 from `origin/main` at `177e136`, against the
loop as it actually runs — the Fixer, the Reviewer's schedule, and the merge gate — not against
the build-order notes. Re-measure before building: every number here is a snapshot.

The loop is described in [`README.md`](./README.md); the roles in `.opencode/agents/`.

## What was measured

```
gh pr list --state open --label factory:review     # 35
gh run view <factory: merge> --log                 # the verdicts below
gh issue list --state open --label factory:explored
```

| Fact | Value |
|---|---|
| Open `factory:review` Changes | 35 (29 mergeable, 3 conflicting, 3 blocked) |
| Refused by the Reviewer on the current head | 34 of 35 |
| Commits behind `main` | 35 of 35, every one at **56** |
| Required checks green on their own head | 34 of 35 (`CI` red on #1846) |
| Changes the gate flags as a one-way door | 17 (payments, auth, scheduler, migrations) |
| `factory:explored` open | 48, of which 12 also carry `factory:blocked` → **36 eligible** |
| Cap on open machine Changes (`MAX_OPEN_CHANGES`) | 20 |

So supply is not the problem: 36 eligible Issues wait behind a cap of 20 open Changes, and the
queue is full of Changes that will not land. The queue is the problem.

## The deadlock, precisely

Four facts compose into a cycle no single part is wrong about:

1. `factory-merge-run.ts:140` refreshes a stale branch **only when being behind is the only
   blocker** — `actionable.every((r) => r.includes(BEHIND_BASE))`.
2. Every one of the 35 Changes is behind, so `update-branch` is the only thing that could clear
   it — and 34 also carry a refuse verdict, so the condition never holds.
3. The Fixer is denied `git push` (`.opencode/agents/fixer.md`) — its Changes are pushed by the
   delivery job — so it cannot rebase itself either.
4. A refuse is answered by restarting the Fixer, three rounds at most, after which AGENTS.md says
   the disagreement "hands over to Cabeda". There is no surface where that handover lands: the
   Change keeps the `factory:review` label and its reasons are printed into a run log that nobody
   opens.

Result: **a Change can be green, mergeable, nobody's work in progress, and permanently ineligible
— while `main` moves 56 commits away from it, which by itself invalidates the CI evidence the gate
would need to merge it.**

Everything the reviewers of this proposal asked for exists already and is therefore *not*
proposed: `factory:explored` is the Fixer's queue (`next-issue.ts`), the Reviewer has a `*/30`
schedule with an empty-list early exit (`factory-reviewer.yml:14-18`), admission control exists
(`MAX_OPEN_CHANGES = 20`), and a merge gate with a tested eligibility predicate exists
(`automerge-eligibility.ts`).

## 1. Publish the gate's verdicts — the reasons already exist, only the surface is missing

**Gap.** Every 30 minutes the merge gate computes, per Change, a full list of reasons it cannot
merge: behind base by N, a check concluded FAILURE, *this file is a one-way door*, the Reviewer's
verdict is refuse. It prints them and discards them. The 35 Changes are therefore a decision list
that exists only inside run logs.

**Proposal.** Have `factory-merge-run.ts` write the same verdicts to one place a human reads: a
single pinned Issue, updated in place, never one per run. Grouped, not dumped —

- **yours to merge** — the one-way doors the gate will never take, with their check status (17
  today; most green),
- **stuck in review** — refused after the third round, with the unresolved finding quoted,
- **waiting on the machine** — behind base, or a red check,
- **conflicting** — needs a human rebase or a close.

No new agent, no new label, no new authority: it is `console.log` pointed at an Issue. The gate
already has the App token and the `issues: read`; writing one Issue needs `issues: write` on the
same installation.

**Files.** `scripts/factory/factory-merge-run.ts`, `src/test/factory-merge-run.test.ts`.

## 2. Refresh an answered Change — break the deadlock instead of waiting for it

**Gap.** The refresh path exists but its guard is too strict (finding 1 above). A stale base is
the one blocker the machine may clear itself, and today it clears none of the 35.

**Proposal.** Widen the guard from *"behind is the only reason"* to *"behind is the only reason
the machine has not already answered"*: treat a refuse verdict that no longer names the current
head as informational, alongside `UNKNOWN`, so `update-branch` fires.

```
refreshable(pr) =
  reasons include BEHIND_BASE
  and every other reason is UNKNOWN or a verdict whose head ≠ pr.headRefOid
  and pr has no merge conflict
```

After the update the head is new, so the Reviewer reads it fresh (the schedule picks the oldest
unread head) and CI runs against the real base — which is the only way a green check means
anything. Rate-limit it to once per Change per 24 hours; `MAX_OPEN_CHANGES` already bounds the
blast radius to 20 Changes.

The rule stays a pure predicate next to `decideAutomerge`, with the counter-example from #1256
(a green run on a stale base reverted a lockfile pin) holding it honest.

**Files.** `scripts/factory/automerge-eligibility.ts`, `scripts/factory/factory-merge-run.ts`,
`src/test/automerge-eligibility.test.ts`.

## 3. Reviewer reach: one filter, not a new workflow

**Gap.** The Reviewer's schedule is real, and its unread-list already skips the agent when empty.
The reason it still never reads a Dependabot or fork Change is one line:
`scripts/factory/next-review.ts:48` keeps only `factory/` heads. The `pull_request` trigger cannot
cover them — a Dependabot or fork run gets no secrets, so no App token — which is exactly why the
scheduled path exists.

**Proposal.** Let the scheduled pick include non-draft Changes from any head, with the fork case
comment-only: the Reviewer may push only to `factory/*`, and never to a branch it does not own.
Human `factory:review` Changes are unaffected; they come through the `pull_request` trigger.

**Files.** `scripts/factory/next-review.ts`, `.opencode/agents/reviewer.md` (the fork line),
`src/test/next-review.test.ts`.

## 4. Post-merge watcher, so "merged" stops meaning "assumed live"

**Gap.** `release.yml` gates on `conclusion == 'success'` for main's CI run and then never probes
what it deployed. A red post-merge run is skipped **silently**, and nothing asserts the served
version. The Sentinel exists to report that and has no trigger, so the signal is missing rather
than late.

**Proposal.** `main-ci-watch.yml` on `workflow_run` for `CI` on `main`, no agent: if the run is
red, or `release.yml` did not run to success, file one incident Issue (`factory:sentinel`) with
the failed jobs, the head SHA, the last tag and the version actually served; if the release
succeeded, assert the served version equals the tag and stay silent. Silence is the healthy state.

`/api/health` carries no version today, so this adds one field, baked from `package.json` at
build — the only product-code edit in the proposal.

**Files.** `.github/workflows/main-ci-watch.yml`, `scripts/factory/deploy-verify.ts`,
`src/pages/api/health.ts`, `src/test/deploy-verify.test.ts`.

## 5. Explorer and Sentinel triggers — the README already promises them

**Gap.** `docs/factory/README.md:76` and `:231` list the Explorer trigger as "schedule / dependency
event" and give every Explorer a cadence. `rg -l "explorer-|sentinel" .github/workflows` returns
nothing: the five agent files have no trigger at all, so "Explorers file Issues" is documentation,
not behaviour. There is no existing dependency event to ride.

**Proposal.** One `factory-explore.yml`, staggered weekly per focus: bugs (Mon), security (Tue,
including a `pull_request`-triggered dependency pass it owns itself), design (monthly). Performance
stays dark until the ADR 0047 Baseline is committed — an Explorer measuring against nothing
produces opinions. Explorers are read-only, so the workflow publishes the Exploration itself:
a step after the agent run commits `docs/explorations/<focus>/<date>.md`.

Turned on only when item 1 has shown the queue draining: a repo variable arms it when open
`factory:review` holds under `MAX_OPEN_CHANGES` for two consecutive days. Supply cannot outrun a
queue that is already full.

**Files.** `.github/workflows/factory-explore.yml`, a `FACTORY_EXPLORERS` repo variable; the
Explorer agents stay untouched.

## Sequencing

| # | Item | Closes | Lands as | Enable when |
|---|---|---|---|---|
| 1 | Publish the verdicts | 35 Changes with no decision surface | 1 Change | immediately |
| 2 | Refresh an answered Change | the deadlock (behind + refuse) | 1 Change | immediately |
| 3 | Reviewer reach filter | Dependabot / fork Changes unread | 1 Change | after 2 |
| 4 | Post-merge watcher | merged ≠ live | 1 Change | independently |
| 5 | Explorer triggers | roles with no trigger | 1 Change, variable-gated | open Changes < 20 for 2 days |

Items 1 and 2 are the pair worth building first: 1 makes the 35 decidable by a human in one pass,
2 stops the machine from re-creating the same rot tomorrow. Items 3–5 are independent and small.

## What this deliberately does not do

- No proposer, no `factory:proposed` label: `factory:explored` is already the Fixer's queue and
  `next-issue.ts` already ranks and caps it.
- No review digest or merge pack *of comments*: the gate's verdicts are the pack (item 1).
- No second Reviewer workflow: the schedule and its early exit exist.
- No machine merge beyond the two-way-door rule already in `AGENTS.md`, and no machine promotion
  of an Issue.
- No remediation: the watcher files and stops (ADR 0045).
- No metric work before a Baseline (ADR 0047).

## Open question for Cabeda

The 17 one-way-door Changes are the ones the machine can never clear by design. If most of the 35
are one-way doors over a week, the honest conclusion is not "a better gate" but "the factory is
producing work only a human can merge" — and the lever becomes Issue selection, not merge tooling.
Item 1's digest is what makes that measurable before spending anything else.
