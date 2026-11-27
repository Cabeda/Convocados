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

No new agent, no new label, **no new App scope** — and that last part is a workflow edit, not a
sentence. The App token in `factory-merge.yml:57-59` carries `issues: read` on purpose (ADR 0046:
the token is blast radius); widening it to `issues: write` so a model-adjacent run can edit an
Issue is the wrong trade. Publish from a **separate job with the built-in `GITHUB_TOKEN`** and
`permissions: issues: write`, the pattern `factory-issue.yml`'s `notice` job already uses — it
holds no App key, sees no model, and its scope ends at one Issue.

So this item **edits a workflow**, which makes it a one-way door Cabeda merges, not an "immediate,
no-new-authority" Change. The sequencing below therefore runs the refresh first and this second.

**Files.** `scripts/factory/factory-merge-run.ts`, `.github/workflows/factory-merge.yml` (the
publish job), `src/test/factory-merge-run.test.ts`.

## 2. Refresh a behind Change — break the deadlock instead of waiting for it

**Gap.** The refresh path exists but its guard is too strict (the condition quoted in the deadlock
above). A stale base is the one blocker the machine may clear itself, and today it clears none of
the 35.

**Proposal.** Widen the guard so the one blocker the machine may clear alone actually gets cleared.

The obvious widening — ignore only a *stale* refuse — does nothing: all 34 refused Changes carry
`the Reviewer's verdict on this head is refuse` (`automerge-eligibility.ts:341`), a verdict that
names the **current** head, so the guard would still never fire. The active refuse is the one to
ignore, because a refresh invalidates it by construction: the verdict is bound to a head SHA,
`update-branch` rewrites the head, and the Reviewer's schedule picks the new head and reads it
fresh. The findings stay in the thread for that read.

```
refreshable(pr) =
  commitsBehindBase > 0
  and mergeable ≠ CONFLICTING
  and isTwoWayDoor(pr.files).reasons.length === 0   // a one-way door is a human's, who can
                                                 // press "Update branch" himself
  and no check concluded FAILURE                 // refresh is for rot, not for red
  and not refreshed in the last 24h              // bounded: MAX_OPEN_CHANGES caps it at 20
```

Note what it is computed from: the structured facts (`commitsBehindBase`, `isTwoWayDoor`,
`latestCheck`, `latestReview`), never the rendered `reasons` strings — the review record holds
the head, so the rule must read `latestReview`, not substring-match a reason. That means
`decideAutomerge` stops being the only consumer of `PullRequestFacts`: add a sibling predicate
`refreshable(facts)` next to it, with the counter-example from #1256 (a green run on a stale base
reverted a lockfile pin) holding it honest.

**What it does not rescue:** the refused Changes still have to clear review after the rebase. A
`refuse` that survives the new head is exactly the disagreement that should reach Cabeda — which
is why the published digest (the item above) is the pair to this one, not a follow-up.

**Files.** `scripts/factory/automerge-eligibility.ts`, `scripts/factory/factory-merge-run.ts`,
`src/test/automerge-eligibility.test.ts`.

## 3. Reviewer reach: one filter, not a new workflow

**Gap.** The Reviewer's schedule is real, and its unread-list already skips the agent when empty.
The reason it still never reads a Dependabot or fork Change is one line:
`scripts/factory/next-review.ts:48` keeps only `factory/` heads. The `pull_request` trigger cannot
cover them — a Dependabot or fork run gets no secrets, so no App token — which is exactly why the
scheduled path exists.

**Proposal.** Let the scheduled pick include non-draft Changes from any head. **The Reviewer pushes
nothing, for any head** — `.opencode/agents/reviewer.md:36-37` denies `git push*` outright and its
prompt says so ("you do not push: your job is to argue in a comment"), so the fork case needs no
new guard: comment-only is already the whole capability. (The "pushes fixes to `factory/*`" line in
`docs/factory/README.md:227` is stale and is corrected in the same Change.)

Human Changes are unaffected; they come through the `pull_request` trigger, and the schedule is
what reaches a Dependabot or fork Change that trigger cannot.

The behaviour this changes is pinned today: `src/test/factory-next-review.test.ts:69` asserts that
`pickReview` returns `null` for `headRefName: "fix/1788-monthly-clamp"`. That test must be
**re-pinned to the new rule**, not deleted — deleting it would make the gate pass by removing the
assertion that proves the picker still works.

**Files.** `scripts/factory/next-review.ts`, `src/test/factory-next-review.test.ts`,
`docs/factory/README.md:227` (the stale push claim).

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

Turned on only when the published digest has shown the queue draining: a repo variable arms it when open
`factory:review` holds under `MAX_OPEN_CHANGES` for two consecutive days. Supply cannot outrun a
queue that is already full.

**Files.** `.github/workflows/factory-explore.yml`, a `FACTORY_EXPLORERS` repo variable; the
Explorer agents stay untouched.

## Sequencing

| Order | Item | Closes | Lands as | Door |
|---|---|---|---|---|
| 1 | Refresh a behind Change (§2) | the deadlock (behind + refuse) | 1 Change | two-way: scripts and their tests |
| 2 | Publish the verdicts (§1) | 35 Changes with no decision surface | 1 Change | **one-way**: adds a job to `factory-merge.yml` |
| 3 | Reviewer reach filter | Dependabot / fork Changes unread | 1 Change | two-way |
| 4 | Post-merge watcher | merged ≠ live | 1 Change | **one-way**: a new workflow |
| 5 | Explorer triggers | roles with no trigger | 1 Change, variable-gated | **one-way**: a new workflow |

The refresh goes first because it is the only one of the five that the Factory can land on its own,
and it is what stops the rot recurring while the rest is being decided. The publish job follows
immediately, and is Cabeda's to merge: it needs no new App scope, but it does add a job to a
workflow file. Items 3–5 are independent.

## What this deliberately does not do

- No proposer, no `factory:proposed` label: `factory:explored` is already the Fixer's queue and
  `next-issue.ts` already ranks and caps it.
- No review digest or merge pack *of comments*: the gate's verdicts are the pack.
- No second Reviewer workflow: the schedule and its early exit exist.
- No machine merge beyond the two-way-door rule already in `AGENTS.md`, and no machine promotion
  of an Issue.
- No widening of the App token's scopes: anything that needs to write away from a branch
  uses the workflow's own `GITHUB_TOKEN` job, as `factory-issue.yml` already does (ADR 0046).
- No remediation: the watcher files and stops (ADR 0045).
- No metric work before a Baseline (ADR 0047).

## Open question for Cabeda

The 17 one-way-door Changes are the ones the machine can never clear by design. If most of the 35
are one-way doors over a week, the honest conclusion is not "a better gate" but "the factory is
producing work only a human can merge" — and the lever becomes Issue selection, not merge tooling.
The published digest is what makes that measurable before spending anything else.
