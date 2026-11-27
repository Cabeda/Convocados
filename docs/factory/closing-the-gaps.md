# Closing the Factory's gaps

A proposal, not a decision. Every number below is a snapshot taken on 2026-11-27 at 14:55 UTC from
`origin/main` and from a live `factory: merge` run (`46016039277`); re-measure before building,
because `main` moved 62 commits while these Changes sat.

The loop is described in [`README.md`](./README.md); the roles in `.opencode/agents/`.

## What was measured

```
gh pr list --state open --label factory:review
gh run view 46016039277 --log      # one verdict line per Change
```

| Fact | Value |
|---|---|
| Open `factory:review` Changes | 35 |
| Refused by the Reviewer on their current head | 32 |
| Behind `main` | 34 at 62 commits, one at 68 |
| Flagged one-way door (payments, auth, scheduler, migrations) | 17 |
| Mergeable | 32 mergeable, 3 conflicting, 0 carrying `factory:blocked` |
| `factory:explored` open | 48, of which 12 also carry `factory:blocked` → **36 eligible** |
| Cap on open machine Changes (`MAX_OPEN_CHANGES`) | 20 |

Supply is not the problem. Thirty-six eligible Issues wait behind a cap of 20 open Changes, and 32
of those open Changes are refused on the code they carry.

## What is actually blocking the queue

Not the stale base. A refuse names the **diff** — `#1873` was refused for three code defects
(reordering an ended roster, editable teams, a 409 raised before authorization), not for being
behind — and a rebase rewrites the head without changing the diff. The Reviewer reads the same code
and refuses again. The gate also already refreshes the one case where the base *is* the only block
(`factory-merge-run.ts:139-140`, an approved Change that fell behind), so "refresh harder" would
only spend Reviewer slots on unchanged diffs, and a refresh landing mid-repair can move the branch
tip under the Fixer's non-forced push (`factory-fix-loop.yml`). **Rebasing refused Changes is
rejected here, deliberately** — it buys a review cycle the diff has not earned.

What blocks the queue is that four different things all end up as the same visible state: a
`factory:review` Change with no next action. One is refused and needs a decision. One is approved
but behind. One is green and a one-way door. One is stuck red. They look identical to the human,
and the reasons exist only inside a run log that nobody opens.

## 1. Publish the gate's verdicts — the reasons exist; only the surface is missing

**Gap.** Every 30 minutes the merge gate computes, per Change, the full list of reasons it cannot
merge: behind base by N, a check concluded FAILURE, *this file is a one-way door*, the Reviewer's
verdict is refuse. It prints them and discards them. The 35 are therefore a decision list that
exists only inside run logs.

**Proposal.** Publish the same verdicts, once an hour, to a single pinned Issue updated in place —
never one Issue per run. Grouped by what the human can do, with the round count for a refused Change
so "refused once" and "refused after three rounds" stop looking the same:

- **yours to merge** — the one-way doors the gate will never take, with their check status (17
  today; most green),
- **argue or close** — refused, with the unresolved finding quoted and how many rounds it has had,
- **waiting on the machine** — behind base, or a red check,
- **conflicting** — needs a human rebase or a close.

No new agent, no new label, no new App scope. The App token in `factory-merge.yml` carries
`issues: read` on purpose (ADR 0046: the token is blast radius), so the write happens in a
**second job** that has no App key at all: the verdict job uploads its JSON with
`actions/upload-artifact`, and the publish job downloads it and writes one Issue with the built-in
`GITHUB_TOKEN` and `permissions: issues: write` — the shape `factory-issue.yml`'s `notice` job
already uses.

**Files.** `scripts/factory/factory-merge-run.ts` (emit the JSON), `.github/workflows/factory-merge.yml`
(upload + publish job), `src/test/factory-merge-run.test.ts`. **Door:** one-way — it edits a workflow.

## 2. Reviewer reach: one filter line

**Gap.** The Reviewer's schedule is real, and its unread-list already skips the agent when empty.
The reason it still never reads a Dependabot or fork Change is one line:
`scripts/factory/next-review.ts:48` keeps only `factory/` heads. The `pull_request` trigger cannot
cover them — a Dependabot or fork run receives no secrets, so no App token — which is exactly why the
scheduled path exists.

**Proposal.** Let the scheduled pick include non-draft Changes from any head. **The Reviewer pushes
nothing, for any head** — `.opencode/agents/reviewer.md:32` denies `git push*` and its prompt says
"you do not push: your job is to argue in a comment" — so the fork case needs no new guard:
comment-only is the whole capability. (The "pushes fixes to `factory/*`" line in
`docs/factory/README.md:229` is stale and is corrected in the same Change.)

Human Changes are unaffected; they arrive through the `pull_request` trigger.

The behaviour this changes is pinned today: `src/test/factory-next-review.test.ts:69` asserts
`pickReview` returns `null` for a human head. That test must be **re-pinned to the new rule**, not
deleted — deleting it would make the gate pass by removing the assertion that proves the picker
still works.

**Files.** `scripts/factory/next-review.ts`, `src/test/factory-next-review.test.ts`,
`docs/factory/README.md:229`. **Door:** one-way (`scripts/factory/`).

## 3. Post-merge watcher, so "merged" stops meaning "assumed live"

**Gap.** `release.yml` is itself a `workflow_run` of CI on `main` and never probes what it deployed.
A release that fails, or that is skipped because CI was red, is silent, and nothing asserts the
served version. The Sentinel exists to report exactly that and has no trigger, so the signal is
missing rather than late.

**Proposal.** `main-ci-watch.yml`, no agent, triggered on `workflow_run` for **both** `CI` and
`Release` on `main` — CI's completion catches a red run (which skips the release), and Release's
completion catches a release that started green and then failed, which a CI-only trigger can never
see:

- red CI, or a `Release` run that concluded anything but success → file **one** incident Issue with
  the failed jobs, the head SHA, the last tag and the version actually served;
- a successful release → assert the served version equals the tag's version, and stay silent.

Silence is the healthy state. The label it files under, `factory:sentinel`, **does not exist yet**,
so the job creates it idempotently (`gh label create … --force`) before filing and the States table
in `docs/factory/README.md:166-172` gains its row in the same Change. No remediation, no retry, no
agent — the ceiling ADR 0045 sets for the Sentinel.

`/api/health` carries no version today, so this adds one field, baked from `package.json` at build;
that is the only product-code edit in the proposal.

**Files.** `.github/workflows/main-ci-watch.yml`, `scripts/factory/deploy-verify.ts`,
`src/pages/api/health.ts`, `docs/factory/README.md`, `src/test/deploy-verify.test.ts`.
**Door:** one-way (a new workflow).

## 4. Explorer triggers — the README already promises them

**Gap.** `docs/factory/README.md:76` and `:231` give every Explorer a cadence ("schedule / dependency
event"). `rg -l "explorer-|sentinel" .github/workflows` returns nothing: the five agent files have no
trigger at all, so "Explorers file Issues" is documentation, not behaviour. There is no existing
dependency event to ride.

**Proposal.** One `factory-explore.yml`, staggered weekly per focus: bugs (Mon), security (Tue,
including a dependency pass it triggers itself), design (monthly). Performance stays dark until the
ADR 0047 Baseline is committed — an Explorer measuring against nothing produces opinions.

Explorers are read-only, so the workflow publishes the Exploration itself, **as a Change, never a
push to `main`**. A delivery step — the pattern `factory-issue.yml` already uses, whose App token
carries `issues: write` — opens `factory/exploration-<focus>-<date>` containing
`docs/explorations/<focus>-<yyyy-mm-dd>/`, the exact path the agents write to
(`.opencode/agents/explorer-bugs.md:44`), and applies the **`no-issue`** label, because an
Exploration closes no Issue and `PR Links Issue` is a required check
(`check-pr-closing-keyword.mjs:27` is the exemption).

Turned on only when the published digest shows the queue draining: a repo variable arms it when open
`factory:review` holds under `MAX_OPEN_CHANGES` for two consecutive days. Supply cannot outrun a
queue that is already full.

**Files.** `.github/workflows/factory-explore.yml`, a `FACTORY_EXPLORERS` repo variable; the Explorer
agents stay untouched. **Door:** one-way (a new workflow).

## Sequencing

Every item is a one-way door, and that is not a defect in the plan: `ONE_WAY_PATHS` matches
`/^scripts\/factory\//` ("the factory's own decision code"), `.github/` and `.opencode/agents/`
(`automerge-eligibility.ts:195`, pinned by `automerge-eligibility.test.ts:241-244`), so a Change that
rewrites the decision code is green, approved, and executes on the next tick. Moving that logic out
of `scripts/factory/` to dodge the classification would be the gate being gamed, not satisfied.

| Order | Item | Closes | Door |
|---|---|---|---|
| 1 | Publish the verdicts | 35 Changes with no decision surface | one-way (`factory-merge.yml`) |
| 2 | Reviewer reach filter | Dependabot / fork Changes never read | one-way (`scripts/factory/`) |
| 3 | Post-merge watcher | merged ≠ live | one-way (new workflow) |
| 4 | Explorer triggers | roles with no trigger | one-way (new workflow) |

Publish first because it is the only item that makes the other 34 decidable, and because it needs no
new behaviour from any agent — it surfaces decisions the gate already makes. Items 2–4 are
independent. Four small Changes, each merged by Cabeda.

## What this deliberately does not do

- **No rebasing of refused Changes.** A rebase rewrites the head, not the diff; the findings stand,
  the next review refuses again, and the CI and review evidence is spent for nothing. Approved-but-
  behind is already refreshed by the gate.
- No proposer, no `factory:proposed` label: `factory:explored` is already the Fixer's queue and
  `next-issue.ts` already ranks and caps it.
- No new merge digest of comments: the gate's verdicts are the digest.
- No second Reviewer workflow, and no widening of `ONE_WAY_PATHS` or of the App token's scopes.
- No machine promotion of an Issue, no machine merge beyond the two-way-door rule in `AGENTS.md`,
  and no remediation (ADR 0045).
- No metric work before a Baseline (ADR 0047).

## The question this proposal cannot answer alone

Seventeen of the 35 open Changes are one-way doors the machine will never merge, and 32 are refused
on the code they carry. Both numbers are statements about *what the Fixer is being asked to build*
— payments, auth, scheduler, invite surfaces — not about the gate. If the share stays this high
after item 1 makes it visible, the lever is Issue selection: the Explorer files what it finds, but
`ready-for-agent` and the queue's composition are Cabeda's. Publishing the verdicts is what makes
that trade measurable before spending anything else on tooling.
