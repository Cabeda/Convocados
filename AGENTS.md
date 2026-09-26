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
- **UI**: Wear Compose (Material 3) + Horologist
- **Type**: Standalone app (`android.hardware.type.watch`, `wearable.standalone=true`)
- **Auth**: Sign in with Google via Credential Manager (standalone; needs Wear OS API 35+) + token sync from phone via Wearable Data Layer + on-watch email/password
- **Offline**: Room DB + WorkManager sync queue
- **Build**: minSdk 35 (Wear OS 5.1+) — Credential Manager's Google provider is unavailable below API 35
- **Package**: `com.cabeda.Convocados` / namespace `dev.convocados.wear`
- **Distribution**: dedicated Wear OS track in Play Console (form-factor opt-in required)

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

### 5. Coverage Thresholds Are a Ratchet (Never Cheat the Gate)
The coverage thresholds in `vitest.config.ts` (`thresholds.lines`, `.statements`,
`.functions`, `.branches`) are a **floor, never a ceiling**. They may only move **up**.

**NEVER lower a coverage threshold to make a failing gate pass.** Nor may you achieve the
same effect by proxy: deleting or `.skip`-ing failing tests, reaching for coverage
`exclude` entries or `/* c8 ignore */`-style suppressions, or weakening assertions so a
test passes without exercising the branch. That is cheating on the tests, and it is
forbidden.

- If coverage drops, write tests that cover the gap, then **raise** the thresholds to the
  new measured values.
- If a path is genuinely unreachable, document it in `docs/coverage.md`; do not silently
  exclude it.
- Lowering any threshold requires explicit written justification **and** the user's
  approval, stated in the PR description. Absent that, a lowered threshold is a bug.

### 6. Metric Integrity (Never Cheat a Benchmark)
Any measured number — coverage, k6 latency, Lighthouse budget, mutation score, bundle
size, PR diff size — is a **gate, not a suggestion**. The same rules that govern the
coverage ratchet govern every other metric:

- **NEVER** make a metric pass by changing the measurement instead of the code. Weakening
  an assertion, lowering a threshold, reducing a load, shortening a scenario, relaxing a
  budget, or deleting the measurement are all the same defect.
- **NEVER** run benchmarks or measurements in parallel. They contend for resources and
  the numbers are invalid. Run them sequentially, on an idle machine.
- **NEVER** reach for an unfair comparison to claim a win: a smaller input, a warmer
  cache, a different configuration, or a hand-rolled harness in place of the committed one.
- When optimising against a target, the target must be **pass/fail and modest** ("at least
  1.2x faster on the named scenario"), and the **baseline must be recorded first, with
  zero changes** (`pnpm k6:load`, LHCI, or the committed config for that metric).
- Correctness is not negotiable against a speed target: a Change that regresses tests,
  coverage, mutation score, or any existing budget is a regression, not an optimisation.
- **Stop** when an iteration buys a statistically insignificant gain (~<5%) while adding
  disproportionate code. The trade is not worth it.
- Speedups that arrive with a suspicious magnitude are a bug report, not an achievement.
  Expect agents to "optimise" by disabling the thing being measured. If it looks too good,
  read the diff line by line.

`docs/factory/` holds the per-metric harnesses and the recorded baselines. If a number in
there is stale, refreshing it is its own Change — do not update a baseline in the same
Change that consumes it.

## Development Workflow

### First-time setup
After cloning, install the git hooks to catch CI failures before they reach the pipeline:
```bash
pnpm setup-hooks
```
This installs:
- a **pre-commit** hook that runs `gitleaks` over staged changes and blocks the commit if a
  secret is found (`scripts/secret-scan.sh staged`), and
- a **pre-push** hook that scans the commits actually being pushed, then runs `lint`,
  `typecheck` and `vitest --coverage`.

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
6. Create PR with descriptive title and summary
7. **NEVER merge PRs unless the user explicitly asks to merge** — always wait for explicit confirmation before merging
8. **Before merging**, always run the full test suite (`pnpm test`) and type checking (`pnpm typecheck`) to ensure the build will succeed in CI/CD

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

`.github/CODEOWNERS` is `* @Cabeda`. Every file in the repo is owned by Cabeda, so **no
Change can reach `main` without Cabeda's review** — this is branch protection, not a
convention, and it is the one guarantee the Delivery Factory depends on.

Because GitHub never lets a PR author satisfy their own review requirement, **the factory
must never push under the `Cabeda` identity**: it would author every one of its own
Changes and permanently block them. The factory authenticates as a GitHub App
(`convocados-factory[bot]`) which is deliberately **not** a code owner, and holds no
approve, merge, or workflow-edit permission.

Consequence worth internalising: **merging a Change deploys it.** `release.yml` fires on
CI green against `main` and then bumps the version, tags, releases, deploys Fly, publishes
Android to the Play internal track, and deploys the scheduler. One click is production.

## The Delivery Factory

The factory turns `ready-for-agent` Issues into ready-to-prod Changes without being asked,
and proposes improvements nobody asked for. It never merges.

**Roles** (each is an opencode agent; see `docs/factory/`):

| Role | Trigger | Does | Never |
|---|---|---|---|
| **Factory** | Issue labelled `ready-for-agent` | Implements, gates, opens the Change, iterates on red | Merge, release, self-label |
| **Reviewer** | Any open PR | Independent review; pushes fixes to `factory/*` | Approve, touch a human branch |
| **Explorer** | Schedule / dependency event | Files well-evidenced Issues (Design, Bugs, Security, Performance) | Write code, self-label |
| **Sentinel** | Unhealthy production signals | Files the incident, drafts the postmortem, pages the human | Remediate anything |

**Gates.** GATE 1 is local and equals the pre-push hook, plus what CI cannot cheaply
repeat: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run --coverage`, `pnpm
test:route-coverage`, `pnpm sync:feature-parity-docs`, Gradle `assembleDebug` for `:app`
and `:wear`, and `pnpm audit --audit-level high`. Playwright runs only when the diff
touches `src/pages/**` or `e2e/**`. GATE 2 is GitHub CI. A Change over **400 changed lines
or 20 files** fails GATE 1 and must **split and hand back** — never silently truncate.

`pnpm audit` sits in GATE 1 deliberately: a fresh CVE in a transitive dependency is not
repairable by editing our code, so it must fail fast as Blocked instead of burning the CI
loop.

**Budgets.** 3 Attempts per gate, 6 per Issue, 500k tokens per Issue, 5M per day. Exceeding
any budget ends the run as **Blocked**, with the evidence attached.

**Handoff.** The Factory's terminal state is **awaiting-human**, never "done". It labels
the Change `factory:review` and comments a summary: what changed, linked Issue, gates
passed, coverage delta, and the full transcript. Blocking state is `factory:blocked`; a
Blocked Issue stays out of the queue until a human clears it.

**Rules for anything in this repository's factory, human or machine:**

- **Only Cabeda applies or removes `ready-for-agent`.** Explorers may not label their own
  output, and the Factory may not pull work that was not offered.
- **Only Cabeda merges.** No agent merges, ever, including after approval.
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

```
src/                        # Web app source
├── components/             # React components (.tsx)
├── pages/
│   └── api/               # Astro API routes (.ts)
├── lib/
│   ├── i18n/              # Translations per locale
│   ├── *.server.ts        # Server-side utilities
│   └── *.ts               # Shared utilities
├── test/                  # Test files
└── prisma/
    └── schema.prisma

android-app/               # Native Android app (Gradle multi-module: :app, :wear)
├── app/src/main/java/dev/convocados/        # :app — phone/tablet
│   ├── data/
│   │   ├── api/           # ApiClient, ConvocadosApi, Models
│   │   ├── auth/          # AuthManager, TokenStore (OAuth 2.1)
│   │   ├── push/          # PushTokenManager, ConvocadosFcmService
│   │   └── datastore/     # SettingsStore (preferences)
│   ├── ui/
│   │   ├── navigation/    # AppNavigation, Route definitions
│   │   ├── screen/        # Feature screens (games, event, profile, etc.)
│   │   └── theme/         # Material 3 theme & colors
│   ├── ConvocadosApp.kt   # Hilt application class
│   ├── MainActivity.kt    # Single activity entry point
│   └── ConvocadosRoot.kt  # Root composable + RootViewModel
├── wear/src/main/java/dev/convocados/wear/  # :wear — Wear OS (standalone)
│   ├── data/
│   │   ├── api/           # ApiClient + remote models
│   │   ├── auth/          # Google Sign-In + Data Layer token sync
│   │   ├── local/         # Room DB (offline cache)
│   │   ├── repository/    # Repositories
│   │   ├── alarm/         # Game alarm scheduling + boot receiver
│   │   └── sync/          # WorkManager sync queue
│   ├── ui/                # Wear Compose screens, navigation, theme
│   ├── di/                # Hilt modules
│   ├── util/              # DateTimeUtil, TickFlow
│   └── WearApp.kt         # Hilt application class
├── app/build.gradle.kts   # :app dependencies
├── wear/build.gradle.kts  # :wear dependencies
├── settings.gradle.kts    # Module includes (:app, :wear)
└── build.gradle.kts       # Project-level plugins
```

## Commands

```bash
# Development
pnpm dev              # Start dev server

# Testing
pnpm test             # Run all tests
pnpm test src/test/api.test.ts   # Run specific test file

# Type Checking
pnpm typecheck        # Check TypeScript types

# Database
pnpm db:generate      # Generate Prisma client
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Prisma Studio
```

## Dev Server Management (for AI agents)

### Parallel previews / worktrees

`pnpm dev` runs `scripts/dev.sh`, which makes every checkout self-contained so
several previews can run at once (the main clone plus any number of
`.worktrees/*`) without port collisions or a shared database:

- **Port** — auto-allocated and cached in `<worktree>/.dev-port`, seeded from a
  hash of the worktree path and scanned upward until free. Override with `PORT`.
- **Database** — defaults to `<worktree>/dev.db` (created and migrated on first
  run), so each preview has its own data. Override with `DATABASE_URL`.
- **Auth** — `BETTER_AUTH_URL` defaults to `http://localhost:<port>`, so cookies
  and OAuth callbacks work on the allocated port. Override explicitly if needed.
- **Node** — `better-sqlite3` needs the Node 24 ABI; the script prefers a
  Node 24 binary when it can find one. Override with `DEV_NODE=/path/to/node`.

The script prints the URL and DB it picked. Different worktrees are different
Astro project roots, so they run concurrently; Astro still refuses two dev
servers in the *same* directory.

```bash
# Start a preview for this worktree (prints http://localhost:<port>)
nohup pnpm dev > /tmp/convocados-dev.log 2>&1 &
echo $! > /tmp/convocados-dev.pid

# Wait for server to be ready (read the port the script chose)
PORT=$(cat .dev-port)
for i in $(seq 1 15); do
  curl -s "http://localhost:$PORT/api/health" | grep -q '"ok"' && break
  sleep 1
done

# Check server logs
cat /tmp/convocados-dev.log

# Stop server
kill $(cat /tmp/convocados-dev.pid) 2>/dev/null
```

To run two previews side by side, run the above in two different worktrees — each
writes its own `.dev-port` and `dev.db`. Pass an explicit `PORT` when you want a
stable URL (e.g. for screenshots or Bruno).

## Bruno API Testing

The `bruno/` folder contains API test collections runnable via Bruno CLI.
The OAuth flow uses a **trusted client** (configured via env vars) that skips
the consent screen, allowing the full flow to run without a browser.

```bash
# Run from the bruno/ directory
cd bruno

# Run the full OAuth flow
bru run auth/2-sign-in.bru \
  oauth2/1-oidc-discovery.bru \
  oauth2/3-generate-pkce.bru \
  oauth2/4-authorize.bru \
  oauth2/5-token-exchange.bru \
  oauth2/6-userinfo.bru \
  oauth2/7-introspect-token.bru \
  oauth2/8-use-token-my-games.bru \
  oauth2/9-use-token-my-stats.bru \
  oauth2/10-refresh-token.bru \
  oauth2/11-revoke-token.bru \
  oauth2/12-verify-revoked.bru \
  --env local

# Run a single folder
bru run oauth2 --env local

# Run with verbose output
bru run oauth2 --env local --verbose
```

The local callback endpoint (`/api/oauth-callback`) returns the auth code as
JSON so Bruno CLI can capture it without needing a browser redirect.

## Event Lifecycle & Game Phases

### Game Phases (progressive disclosure)

The event page adapts its UI based on the current phase:

| Phase | Condition | Header shows | Payment section |
|-------|-----------|-------------|-----------------|
| **Upcoming (normal)** | >24h before | Full date + recurrence | Hidden (no cost) or collapsed summary |
| **Upcoming (soon)** | <24h before | Countdown + date | Prominent CTA if user owes |
| **Upcoming (urgent)** | <2h before | Countdown only | Prominent CTA |
| **Live** | During game | Pulsing "Live now" | Hidden |
| **Past (one-off)** | After game | "Ended" (grey) | Hidden |
| **Past (recurring)** | After game, has recurrence | "Next game: [date]" (blue) + recurrence pattern | Hidden |

### Recurring Event Reset

When `nextResetAt` passes (game end time), the lazy reset:
- Creates a `GameHistory` snapshot (teams, payments)
- Clears payments and team assignments
- Advances `dateTime` to next occurrence
- Marks old `Game` as "played", creates new `Game`
- **Players persist** — they stay on the list for the next game
- **Follows persist** — EventFollow records are event-scoped, not game-scoped

### Follow & Notification Model

**Philosophy:** Notifications go to the right people at the right time. Being on the player list = following = getting notified. No unnecessary noise for spectators.

#### Follow rules:
- **On player list** → automatically following (can't unfollow while playing)
- **Not on player list** → can manually follow/unfollow via the Follow button
- **Auto-follow triggers:** Quick Join, claim player, admin grant, push subscription
- **Auto-unfollow:** only on self-removal from player list

#### Notification tiers (ADR 0017):

| Notification type | Players | Followers (not playing) |
|---|---|---|
| Game reminders (24h, 2h) | ✅ | ❌ |
| Player activity (joins/leaves) | ✅ | ❌ |
| Post-game (score, MVP, payments) | ✅ | ❌ |
| Event changes (date/location/title) | ✅ | ✅ |
| Recruitment (spots available) | ✅ | ✅ |

#### Resolution order for notification delivery:
1. Per-user per-event override (`EventFollow.muteX` fields)
2. Role-based default (non-players blocked from Tier 2)
3. Global user preferences (`NotificationPreferences`)

#### User-facing controls:
- **Follow button** (EventHeader): shown only to non-players. Simple toggle.
- **"My notifications" dialog** (More menu): shown to all authenticated users. Per-game toggle with clear descriptions. Shows effective state (push disabled warning, player-only gating).
- **User account settings**: global push/email on/off, reminder timing.

## Common Patterns

### API Route Handler
```typescript
export const POST: APIRoute = async ({ params, request }) => {
  const limited = rateLimitResponse(request, "write");
  if (limited) return limited;

  const body = await request.json();
  // Validate body
  // Process request
  return Response.json({ ok: true });
};
```

### React Component with i18n
```typescript
import { useT } from "~/lib/useT";

export function MyComponent() {
  const t = useT();
  return <Button>{t("buttonLabel")}</Button>;
}
```

### Adding New i18n Strings
1. Add key to `src/lib/i18n/en.ts` (source of truth)
2. Add translations to all locale files: `pt.ts`, `es.ts`, `fr.ts`, `de.ts`, `it.ts`
3. Use `t("newKey")` in components

## Reviewing Checklist

Before submitting a PR:
- [ ] Answers the mission question: does this let people play more, with less administration?
- [ ] Lint passes (`pnpm lint --max-warnings 259`)
- [ ] All tests pass (`pnpm test`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] Coverage thresholds only raised, never lowered (see Core Principle 5)
- [ ] No metric gamed to pass — thresholds, loads, budgets and assertions unchanged (Core Principle 6)
- [ ] Within 400 changed lines and 20 files, or the issue was split
- [ ] i18n strings added to all 6 locales
- [ ] Platform parity considered (web ↔ Android apps)
- [ ] Database migrations included (if schema changed)
- [ ] Documentation updated (if API changed)
- [ ] No console errors in browser
- [ ] Rate limiting applied to mutations
- [ ] Error responses use appropriate status codes

## Issue Tracker (dex)

This project uses **[dex](https://dex.rip)** for issue tracking. Run `dex --help` for the CLI.

### Quick Reference

```bash
dex ready              # Find available work
dex show <id>          # View issue details
dex start <id>         # Claim work
dex complete <id>      # Complete work
dex sync               # Push tasks to GitHub Issues
```

### Rules

- Use `dex` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- GitHub sync is enabled with `on_change = true` (auto-sync on every mutation)
- Tasks are stored at `.dex/tasks.jsonl` (committed to repo) and synced to GitHub Issues

### Two ledgers, and the machine exception

| Ledger | Owner | Holds |
|---|---|---|
| **dex** (`.dex/tasks.jsonl`) | Humans | Plans, follow-ups, postmortem actions |
| **GitHub labels + comments** | The factory | Runtime state: queue, Claim, Handoff, Blocked |

`dex` is a local CLI and is **not installed on the GitHub runner**, so machine-written
issues cannot be dex tasks. The one exception to "use dex for ALL task tracking":

> **Explorers and the Sentinel file GitHub issues directly**, labelled `factory:explored`,
> and commit their reasoning to `docs/explorations/`. Humans keep dex.

An Explorer never applies `ready-for-agent` to its own issue. Promotion from
`factory:explored` to `ready-for-agent` is the human's decision, always.

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
