# AGENTS.md - Development Guidelines

## Project Overview

**Convocados** is a sports event management application with a web app and a native Android app.

### Web App (root `/`)
- **Framework**: Astro 6.x with React 19
- **Database**: Prisma with SQLite (WAL mode, Litestream backups in production)
- **Styling**: Material-UI (MUI)
- **Testing**: Vitest
- **Language**: TypeScript

### Android App (`android-app/`)
Gradle multi-module project — `:app` (phone/tablet) and `:wear` (Wear OS).
- **Language**: Kotlin
- **UI**: Jetpack Compose with Material 3
- **DI**: Hilt (Dagger)
- **Networking**: Ktor client
- **Build**: Gradle with KSP, targetSdk 35

**`:app` (phone)**
- **Auth**: OAuth 2.1 via Custom Tabs (redirect scheme: `convocados://auth`)
- **Push**: Firebase Cloud Messaging (FCM) via `firebase-messaging-ktx`
- **Build**: minSdk 26
- **Package**: `com.cabeda.convocados` / namespace `dev.convocados`

**`:wear` (Wear OS)**
- **UI**: Wear Compose (Material 3)
- **Type**: Standalone app (`android.hardware.type.watch`, `wearable.standalone=true`)
- **Auth**: Sign in with Google via Credential Manager (standalone; needs Wear OS API 35+) + token sync from phone via Wearable Data Layer + on-watch email/password
- **Offline**: Room DB + WorkManager sync queue
- **Build**: minSdk 35 (Wear OS 5.1+) — Credential Manager's Google provider is unavailable below API 35
- **Package**: `com.cabeda.Convocados` / namespace `dev.convocados.wear`
- **Distribution**: dedicated Wear OS track in Play Console (form-factor opt-in required)
- **Verification**: a Wear UI change ships only after it is checked on **both** a round
  and a square display (`RoundSafeLayout.kt` has a round branch and a square `else`, so a
  fix written against one shape silently no-ops on the other). Procedure:
  [`CODING_STANDARDS.md`](CODING_STANDARDS.md) → *Wear UI: verify on round and square*.

## Mission

**Convocados exists so a group of friends can actually play the game.**

Three pillars, in priority order:

- **Simple to run** — the organizer needs almost no head-knowledge. No setup guide, no
  admin ritual, no "it depends on the app" instructions.
- **Fun and engaging** — people want to come back. Showing up should feel good.
- **Management-free** — whatever an organizer has to think about must **shrink**, never
  grow, as the group gets busier. Every feature that adds ceremony is a bug.

One question judges every change, at every altitude:

> **Does this let people play more, with less administration?**

If a proposal cannot answer that question in one sentence, it does not ship — no matter how
good the code is. The three pillars are the terms a reviewer cites when it blocks a Change,
and the terms an Explorer must name when it files an issue. An issue that serves no pillar
is not filed.

**Where we strive**: every change lands as a *ready-to-prod* Change — green CI, independently
reviewed, evidence attached, one human click from merging. Nothing reaches `main` by machine.

## Core Principles

### 1. Test-Driven Development (TDD)
All features **must** follow TDD approach:
1. **Write failing tests first** - Define expected behavior before implementation
2. **Implement minimum code** - Write just enough to pass the test
3. **Refactor** - Clean up while keeping tests green

### 2. Code Quality
- Keep code **simple and readable**
- Use meaningful variable/function names
- Prefer small, focused functions over large ones
- Avoid premature optimization
- Comment complex logic, not obvious code

### 3. All Changes Require Tests
Every change must include tests that prove the functionality works:
- New features → New test coverage
- Bug fixes → Regression tests
- Refactoring → Ensure existing tests still pass

### 4. Platform Parity
Web and the Android apps (`:app`, `:wear`) stay in sync for user-facing features. A feature
that ships on one platform ships on the others in the **same PR** or an explicitly linked
follow-up ticket (Wear included where the affordance exists). No "web-only" or "app-only"
UI drift.

### 5 & 6. Thresholds are a ratchet; metrics are never gamed

Thresholds move **up** only, and no measured number — coverage, k6 latency, Lighthouse
budget, bundle size, PR diff size — may pass by changing the measurement instead of the
code. The full rule, with the proxy cheats enumerated (deleting tests, `exclude` entries,
`/* c8 ignore */`, weaker assertions, warmer caches, smaller inputs), is in
[`CODING_STANDARDS.md`](CODING_STANDARDS.md) under **Never cheat a gate**, which the
reviewer applies at review time. If coverage drops, write the test that covers the gap
and raise the threshold to the new measured value.

## Development Workflow

### First-time setup
After cloning, install the git hooks to catch CI failures before they reach the pipeline:
```bash
pnpm setup-hooks
```
This installs:
- a **pre-commit** hook that runs `gitleaks` over staged changes and blocks the commit if a
  secret is found (`scripts/secret-scan.sh staged`), and
- a **pre-push** hook that runs every cheap gate — `lint`, `typecheck`, `route-coverage`,
  `check:feature-parity`, `check:play-listing`, `check:play-screenshots`, `audit` — then the
  suite with coverage. The cheap checks run first so a fast failure does not wait four minutes
  for the answer.

Never re-point the pre-push scan at the git index (`gitleaks ... --staged`): at push time the
index is empty, so it checks nothing while reporting success. Push scanning must use the
`--log-opts` range supplied on stdin.

**NEVER use `git push --no-verify`**. If the pre-push hook fails, fix the underlying issue (lint errors, type errors, failing tests) rather than bypassing the hook. The hook exists to prevent broken code from reaching the remote.

### Branch Naming
```
feat/short-description    # New features
fix/short-description     # Bug fixes
refactor/short-description # Code improvements
```

### Commit Messages
Follow conventional commits:
```
feat: add user authentication
fix: resolve login redirect issue
refactor: simplify event creation logic
test: add tests for player claiming
docs: update AGENTS.md
```

### Pull Request Process
1. Create feature branch from `main`
2. Write failing tests
3. Implement feature
4. Ensure all tests pass (`pnpm test`)
5. Run type checking (`pnpm typecheck`)
6. Write the PR body with the **`pr` skill when the session has it** (invoke the skill; it
   supplies the Summary / Evidence / Merge Danger template). Read the diff first so the
   Summary carries the smallest view that makes the change legible.
7. **A UI change shows before and after.** Any diff that changes what a user sees — web
   screens or the Android apps (`:app`, `:wear`) — embeds a **before/after screenshot pair**
   in the PR body's Evidence. Host the images on a `pr-assets/<pr-number>-<slug>` branch so
   they stay out of the Change's diff, and reference them by raw URL. An after-only
   screenshot does not prove the change; the reviewer needs the pair.
8. Before `gh pr create`, run `pnpm check:pr-body <body.md>` against the body file. It is
   the same script the `PR Links Issue` job runs, reached from the command line, and it is
   the only place the rule is checkable in time: CI sees the body after the PR exists, so a
   failure there always costs a second trip. It passes only on a closing keyword
   (`Closes #<n>`, `Fixes #<n>`, `Resolves #<n>`), which is what makes GitHub close the
   linked issue on merge and what stops the next agent reading a solved bug as live work. A
   PR that closes nothing passes with `pnpm check:pr-body <body.md> --no-issue`.
9. **NEVER merge PRs unless the user explicitly asks to merge** — always wait for explicit confirmation before merging
10. **Before merging**, always run the full test suite (`pnpm test`) and type checking (`pnpm typecheck`) to ensure the build will succeed in CI/CD

**CRITICAL: ALL changes MUST go through PRs.** Never push directly to `main`. This includes:
- Bug fixes (even one-liners)
- Config changes
- Documentation updates
- Hotfixes

The only exception is the automated version bump commit from the release workflow (`[skip ci]`).

**Workflow:**
```
main (protected) ← PR ← feat/branch
```
Never `git push origin main` directly. Always:
1. Create a branch
2. Push the branch
3. Open a PR
4. Wait for CI
5. Merge only when user confirms

### Merge Authority

`.github/CODEOWNERS` is `* @Cabeda`, so GitHub requests Cabeda's review on every Change. What
**stops a machine from merging** is not that request — the `main` ruleset sets
`required_approving_review_count: 0` and `require_code_owner_review: false` — but the factory
App's own permissions: `convocados-factory[bot]` holds no approve, merge, or workflow-edit
right, so a green Change it authored still cannot be merged by it. Review is the process; the
App's permission is the mechanism. Do not conflate them.

The ruleset does enforce `CI` and `Analyze (javascript-typescript)`, and blocks deletion and
non-fast-forward pushes to `main`. A `RepositoryRole: Admin` bypass (`bypass_mode: always`)
lets the owner override — which is how a human merges their own PR, since GitHub never lets a
PR author satisfy their own review requirement.

> **Fixed 2026-10-16.** The ruleset also carried `code_quality: { severity: "errors" }` while
> the repo had no Code Quality analysis at all, so *no* PR was ever mergeable without that
> admin override — and the override disables every other rule in the set, including the
> required checks. Protection looked present and was in fact always bypassed. The rule is
> removed; verify a green PR merges with no `--admin` if you change this block.

Consequence worth internalising: **merging a Change deploys it.** `release.yml` fires on
CI green against `main` and then bumps the version, tags, releases, deploys Fly, publishes
Android to the Play internal track, and deploys the scheduler. One click is production.

## The Delivery Factory

The factory turns `ready-for-agent` Issues into ready-to-prod Changes without being asked,
and proposes improvements nobody asked for. It never merges.

**Roles, reach, budgets, handoff and the automerge exception** are documented in
[`docs/factory/README.md`](docs/factory/README.md): the five roles and what each one never
does, the two structural gaps in the Reviewer's reach, the Attempt/token budgets, the
`awaiting-human` handoff, and the four properties that keep `FACTORY_AUTOMERGE` narrow.
Reach for it when writing or reviewing a factory Change, or when a label, a gate or a
budget is in question. The rules below are what every session obeys without reaching for
anything.

**Gates.** GATE 1 is the pre-push hook, and it is web-only. It runs the cheap checks first —
`pnpm lint` (errors **and** the warning cap, which lives on the script so CI enforces the same
number), `pnpm test:route-coverage` (fails on any untested route),
`pnpm check:feature-parity`, `pnpm check:play-listing`, `pnpm check:play-screenshots`,
`pnpm audit --audit-level high`, gitleaks over the pushed commits, and semgrep (warn-only) —
then `pnpm typecheck` and the suite with coverage. `src/test/gate-parity.test.ts` fails if this
hook and `scripts/factory/gate.sh` disagree about the cheap set, so "GATE 1 passed" has one
meaning. The slow gates stay out of the hook: run `pnpm test:e2e` and the Gradle
`:app`/`:wear` builds yourself before handing a Change back. GATE 2 is GitHub CI, which repeats
GATE 1 and adds Playwright, the Android builds and Lighthouse. A Change over **400 changed lines
or 20 files** fails GATE 1 and must **split and hand back** — never silently truncate. The
one exception a Change may claim without being split: a change and the test harness that
re-encodes its invariant are one unit, because neither half is correct alone. Claim it in
the PR body rather than silently exceeding.
The cap governs a **factory Change** (one ticket); a human-driven integration wave PR may
exceed it only when every ticket merged into it individually stayed under the cap — and the
wave PR description must **list the merged ticket PR numbers**, so the claim is checkable
rather than prose. On a
wave: run targeted tests after each merge and the full suite **once** at the end of the
wave — re-running everything per merge re-pays for merging, not for the work, and CI is the
backstop.

`pnpm audit` sits in GATE 1 deliberately: a fresh CVE in a transitive dependency is not
repairable by editing our code, so it must fail fast as Blocked instead of burning the CI
loop.

**Rules for anything in this repository's factory, human or machine:**

- **Only Cabeda applies or removes `ready-for-agent`.** Explorers may not label their own
  output, and the Factory may not pull work that was not offered.
- **`wayfinder:grilling` marks an Issue whose spec is not yet implementable** — it needs a
  grilling session first. The Factory ignores it; promotion to `ready-for-agent` is
  Cabeda's call.
- **Only Cabeda merges.** No agent merges, ever, including after approval.
- **`FACTORY_AUTOMERGE=true` (a repo variable) is the single exception, and it is
  off by default.** It lets `scripts/factory/automerge-run.ts` arm GitHub auto-merge
  on **machine-authored Dependabot bumps only**, and nothing else. Four properties
  keep that narrow — the four properties, each with the failure it prevents
  (a green run on a stale base, `pull-requests: write` calling the merge
  endpoint, an armed merge that survives unsetting the variable), are in
  `scripts/factory/automerge-run.ts`. Reach for them when
  touching the automerge workflow or deciding whether an arm is still valid.
  The workflow also honours `FACTORY_PAUSED` first, like every other factory
  entry point.

  A human-authored Change is **never** auto-merged, at any gate state. Setting this
  variable is the activation, and no machine may set or clear it.
- **The factory branches from `origin/main` only** — never from a local checkout or another
  feature branch, so no Change inherits half-finished work.
- **`FACTORY_PAUSED=true` (a repo variable) stops everything** at every entry point. No
  machine may set or clear it.
- **Agents may edit this file, but the edit ships as its own PR**, flagged in the
  description. A machine that edits its own constitution is unauditable.

See `docs/factory/` for the runbooks, `docs/factory/CONTEXT.md` for the vocabulary, and
`CONTEXT-MAP.md` for how the two contexts relate.

## Testing Guidelines

### Test File Location
- Unit tests: `src/test/*.test.ts` or `src/**/__tests__/*.test.ts`
- Integration tests: `src/test/*.test.ts` (for API routes)

### Test Structure
```typescript
describe("Feature/Component", () => {
  beforeEach(async () => {
    // Reset state, clear database
  });

  it("should do something specific", async () => {
    // Arrange - Set up test data
    // Act - Execute the code under test
    // Assert - Verify expected outcomes
  });
});
```

### Database Tests
- Use the test database (`test.db`)
- Clean up in `beforeEach`:
```typescript
beforeEach(async () => {
  await prisma.model.deleteMany();
  // Reset rate limiters
  resetRateLimitStore();
  resetApiRateLimitStore();
});
```

### Mocking
- Use `vi.fn()` for function mocks
- Use `vi.stubGlobal()` for global mocks
- Always cleanup: `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`

## Code Style

Judgement-call standards that a review enforces but no linter can (round-vs-square layouts
on Wear, test-scaffolding extraction, fixture placement) live in
[`CODING_STANDARDS.md`](CODING_STANDARDS.md) — read it during review, not implementation.

### TypeScript
- Strict mode enabled
- Avoid `any` - use proper types
- Use discriminated unions for state
- Prefer interfaces for object shapes

### React Components
- Functional components with hooks
- Keep components focused on single responsibility
- Extract reusable logic to custom hooks
- Use MUI components for consistency

### API Routes
- Validate input early
- Return proper HTTP status codes
- Use descriptive error messages
- Apply rate limiting for mutations

### Database
- Use Prisma client (`prisma` from `~/lib/db.server`)
- Transactions for related operations
- Index frequently queried fields

## Project Structure

Full tree, per-screen layout, tests, and screenshots:
[`docs/development-guide.md`](docs/development-guide.md).

### Searching

Use `rg` — or the harness's `grep` tool, which is ripgrep-backed — for every search. Both
honour `.gitignore`; a shell `grep -rn` does not, and `src/lib/__generated__/` is a
gitignored 6.2 MB generated Prisma client sitting inside `src/`. On one query
(`accessPassword`) `rg` returned 7 KB across 26 files and a shell grep returned 190 KB
across 30, with 133 of its hits inside the generated client.

## Reference guides

Run `scripts/worktree-bootstrap.sh` before any gate — it repairs the half-installed
`node_modules`/`.bin` links, the gitignored Android env files, and the Prisma client, and
is idempotent. Reach for it on two triggers: a worktree that has just been created, and a
compile or typecheck error naming a symbol the schema or a generated client should already
have (a stale Prisma client is the usual cause, and regenerating by hand is the slow path). Worked detail that only some tasks need lives in
[`docs/development-guide.md`](docs/development-guide.md): dev-server/worktree management,
Bruno API flows, event lifecycle & game phases, and the **shared seams** — the one module that
answers each recurring question (authorization, money, roster capacity, notification audience,
locale dates), and the traps that come with them. To inspect
production — read-only DB queries, the job queue, the scheduler — see
[`docs/runbooks/production-inspection.md`](docs/runbooks/production-inspection.md).

## Reviewing Checklist

Before submitting a PR:
- [ ] Answers the mission question: does this let people play more, with less administration?
- [ ] Lint passes (`pnpm lint --max-warnings 259`)
- [ ] All tests pass (`pnpm test`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] Coverage thresholds only raised, never lowered (see Core Principle 5, detail in [`CODING_STANDARDS.md`](CODING_STANDARDS.md))
- [ ] No metric gamed to pass — thresholds, loads, budgets and assertions unchanged (see [`CODING_STANDARDS.md`](CODING_STANDARDS.md))
- [ ] Within 400 changed lines and 20 files, or the issue was split
- [ ] i18n strings added to all 6 locales
- [ ] Platform parity considered (web ↔ Android apps)
- [ ] PR body written with the `pr` skill when the session has it
- [ ] UI change → PR body embeds a **before/after screenshot pair** (hosted on a `pr-assets/<n>-<slug>` branch)
- [ ] Wear UI change verified on **both** round and square goldens, if Wear UI changed (see `CODING_STANDARDS.md`)
- [ ] Database migrations included (if schema changed)
- [ ] Documentation updated (if API changed)
- [ ] No console errors in browser
- [ ] Rate limiting applied to mutations
- [ ] Error responses use appropriate status codes

## Issue Tracker (dex)

This project uses **[dex](https://dex.rip)** for issue tracking. Full reference (quick
commands, rules, ledger/merge handling): [`docs/dex.md`](docs/dex.md). Run `dex --help`
for the CLI. Storage: `.dex/tasks.jsonl` (committed); syncs to GitHub Issues. Reconcile
duplicate ledger ids with `node scripts/dex-dedupe.mjs --check`.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until the PR is created and pushed.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - `dex create "..."` for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - `dex complete` finished work, `dex start` in-progress items
4. **Create PR and push branch** - This is MANDATORY:
   ```bash
   # Create branch if on main
   git checkout -b feat/description-of-work  # or fix/ refactor/ etc.
   git add <files>
   git commit -m "feat: description"
   git push -u origin feat/description-of-work
   gh pr create --title "feat: description" --body "Summary of changes"
   ```
5. **Wait for CI** - Check `gh pr checks <number>` passes
6. **Clean up** - Clear stashes, prune remote branches
7. **Verify** - Branch pushed, PR created, CI green
8. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- NEVER push directly to `main` — always use a PR
- Work is NOT complete until the PR is created and pushed to the remote
- NEVER stop before pushing the branch — that leaves work stranded locally
- NEVER say "ready to push when you are" — YOU must push the branch and create the PR
- If push fails, resolve and retry until it succeeds
- Only merge when the user explicitly asks to merge
- If CI fails on the PR, fix the issue on the same branch and push again
