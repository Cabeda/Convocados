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
- **Auth**: Direct Google Sign-In on watch + token sync from phone via Wearable Data Layer
- **Offline**: Room DB + WorkManager sync queue
- **Build**: minSdk 30 (Wear OS 3+ → Pixel Watch & Galaxy Watch 4+)
- **Package**: `com.cabeda.Convocados` / namespace `dev.convocados.wear`
- **Distribution**: dedicated Wear OS track in Play Console (form-factor opt-in required)

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

## Development Workflow

### First-time setup
After cloning, install the git hooks to catch CI failures before they reach the pipeline:
```bash
npm run setup-hooks
```
This installs a pre-push hook that runs `lint`, `typecheck` and `vitest --coverage` before every push.

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
4. Ensure all tests pass (`npm run test`)
5. Run type checking (`npm run typecheck`)
6. Create PR with descriptive title and summary
7. **NEVER merge PRs unless the user explicitly asks to merge** — always wait for explicit confirmation before merging
8. **Before merging**, always run the full test suite (`npm run test`) and type checking (`npm run typecheck`) to ensure the build will succeed in CI/CD

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
npm run dev          # Start dev server

# Testing
npm run test         # Run all tests
npm run test -- src/test/api.test.ts  # Run specific test file

# Type Checking
npm run typecheck    # Check TypeScript types

# Database
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run migrations
npm run db:studio    # Open Prisma Studio
```

## Dev Server Management (for AI agents)

When running integration tests or Bruno API tests, the agent can manage the dev server:

```bash
# Start dev server in background
pkill -f "astro dev" 2>/dev/null || true
nohup npm run dev > /tmp/convocados-dev.log 2>&1 &
echo $! > /tmp/convocados-dev.pid

# Wait for server to be ready
for i in $(seq 1 15); do
  curl -s http://localhost:4321/api/health | grep -q '"ok"' && break
  sleep 1
done

# Check server logs
cat /tmp/convocados-dev.log

# Restart server
kill $(cat /tmp/convocados-dev.pid) 2>/dev/null; sleep 1
nohup npm run dev > /tmp/convocados-dev.log 2>&1 &
echo $! > /tmp/convocados-dev.pid

# Stop server
kill $(cat /tmp/convocados-dev.pid) 2>/dev/null
```

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
- [ ] Lint passes (`npm run lint -- --max-warnings 259`)
- [ ] All tests pass (`npm run test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] i18n strings added to all 6 locales
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
