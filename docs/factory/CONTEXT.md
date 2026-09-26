# Delivery Factory — Domain Glossary

The automation that turns Issues into Changes, and watches for what should be built next.
It is a separate bounded context from the product in [CONTEXT.md](../../CONTEXT.md): the
terms below describe work being made, not sport being played.

## Factory
The agent that takes an Issue offered to it and produces a Change: it works in an isolated
workspace, passes it through the Gates, opens the Change, and repairs red gates up to a
Budget. Its terminal state is never "done" — it is always Handoff or Blocked.

The Factory is one worker, not a pool of specialists. Specialisation happens in Explorers
and in Review lenses, because what differs between kinds of work is the *check*, not the
implementation.
_Avoid_: Manager (that is the dispatch step), orchestrator (too vague — it names the system,
not the role), CI

## Issue
A unit of work with an acceptance criterion, small enough to finish in one session. Issues
are the only thing the Factory accepts as input, and only when a human has marked them
Ready. Explorers propose Issues; they never make them Ready.
_Avoid_: task (that is a dex task, a human ledger entry), ticket (use Issue), bug (an Issue
may be a bug, a feature, or a chore)

## Change
A proposed modification to the repository, materialised as a pull request. The Factory's
output. A Change is a unit of review, not a unit of work: one Issue may produce one Change,
or several if it had to split.
_Avoid_: PR (acceptable as the GitHub object name, but the domain term is Change), patch,
commit series, diff (that is one view of a Change)

## Gate
A pass/fail check a Change must clear before it can advance. Two exist: the local Gate,
run in the workspace before pushing, and the CI Gate, run by GitHub. A Gate is *evidence*,
not opinion — it produces a pass/fail and a log, never a judgement call.
_Avoid_: test (a Gate is broader than tests), check (ambiguous with CI's job names),
quality bar

## Attempt
One repair cycle against a failing Gate: read the failure, change the code, re-run. Each
Gate allows a bounded number before the run ends as Blocked. A fresh Attempt is a fresh
agent session — the workspace and the branch persist, the reasoning does not.
_Avoid_: iteration (ambiguous with Explorers' scheduled runs), retry, fix, try

## Budget
The ceilings on a run: Attempts per Gate, Attempts per Issue, tokens per Issue, tokens per
day. A Budget is a hard stop that produces Blocked with evidence attached, not a hint to
wrap up.
_Avoid_: limit (reads as a preference), quota (means the provider's limit, not ours), timeout

## Claim
The exclusive right to work on an Issue, recorded where a restarted process can read it.
Prevents two runs from picking up the same work. A Claim is a lease, not a lock: it goes
stale and is reclaimed.
_Avoid_: assignment, lock, lease (the lease is the mechanism, the Claim is the right),
reservation

## Handoff
The Factory's terminal success state: a Change that cleared both Gates and carries a
summary, evidence, and a request for human review. Handoff is a *state of waiting*, never a
state of completion. Nothing is finished until a human merges it.
_Avoid_: done, complete, finished, ready, delivered, review-requested

## Ready-to-prod
The quality bar a Change must meet to be worth a human's attention: both Gates green,
independently reviewed, evidence attached, scoped small enough to read in one sitting. It
describes the Change's readiness for a decision — never permission to ship.
_Avoid_: prod-ready (same meaning, less careful), release-ready, done, mergeable (a
mechanical GitHub state, not a judgement)

## Blocked
The terminal failure state, with evidence: the failing command, its exit code, the log
tail, and what was tried. Blocked means "a human must decide", not "an agent gave up".
A Blocked Issue leaves the queue until a human clears it.
_Avoid_: failed, broken, stuck, gave up, needs-human (that is the Sentinel's action, not
this state)

## Reviewer
The agent that reads a Change and decides whether it is ready for a human, against the
Mission and Core Principles rather than against the Gates — the Gates already passed, so
re-running them is not review. It holds no approval authority: its job is to argue in a
comment and to fix what it can on a factory branch.

It watches **every** open Change, including human-authored ones, because a review that
only inspects machine work is a rubber stamp.
_Avoid_: approver, gatekeeper, QA, linter

## Hard Block
A category of Change the Reviewer may not pass on its own judgement: it reports and stops.
Migrations, auth and token handling, the scheduler, workflows and deploy configuration, and
any edit to a coverage threshold. The Reviewer's judgement is a first opinion on these, not
the decision.
_Avoid_: forbidden path, protected path, stop-ship

## Explorer
A read-only agent that looks for work rather than doing it. An Explorer investigates one
focus — Design, Bugs, Security, or Performance — and its only output is a well-evidenced
Issue. It never writes code and never makes an Issue Ready.
_Avoid_: researcher (a role, not a purpose), scout, analyst, auditor (implies an opinion
the Explorer does not deliver), reviewer (opposite: the Explorer looks *for* Changes, the
Reviewer judges existing ones)

## Exploration
An Explorer's committed record of what it looked at and what it concluded, including the
dead ends. Its purpose is memory: an Explorer that cannot recall last week's findings will
propose them again. An Exploration that produced no Issue is still committed, because "we
looked and there is nothing" is a result.
_Avoid_: log, report, notes, finding (a finding without an Issue is an Exploration)

## Baseline
A recorded measurement, taken with zero code changes, committed to the repository before
anything is measured against it. A Baseline is what makes a Target falsifiable; without one,
"faster" is an opinion.
_Avoid_: benchmark result (that's an output, not the committed reference), before-state,
control

## Target
A pass/fail performance constraint stated against a named Baseline ("at least 1.2x faster
on this scenario, with no regression anywhere else"). Targets are deliberately modest: a
large target invites reckless rewrites and metric-gaming. Reaching a Target is not
convergence — see the stop rule in Core Principle 6.
_Avoid_: goal (a Target is measurable, a goal need not be), objective, KPI, budget (taken)

## Sentinel
The agent that watches production and reports what it finds. On unhealthy signals it files
the incident, drafts the postmortem, and pages a human. It has no authority to change
production — not to scale, restart, roll back, deploy, or migrate. Its value is that a human
is *told*, promptly, with a timeline attached.
_Avoid_: on-call agent (the name invites the authority it does not have), medic, watchdog,
health check (that is a mechanism it reads, not the role), Sentry, autohealer

## Blameless
The rule that a postmortem names systems and decisions, never the agent and never the human.
It exists so that a Sentinel which can be blamed learns to hide its uncertainty, which
destroys the one thing it is for.
_Avoid_: non-accusatory, no-blame, fair

## Note: "Skill" is two words here

"Skill" already means **player rating** in this repository (`Skill Rating`, the OpenSkill
engine behind `scripts/recompute-skill-ratings.ts`) and **agent skill** in the tooling
(`.continue/skills/`, `skills-lock.json`). They are unrelated. In this context, an agent
skill is always written "agent skill", and a player skill is always "Skill Rating".
_Avoid_: (nothing — this note exists because the collision is already in the codebase)
