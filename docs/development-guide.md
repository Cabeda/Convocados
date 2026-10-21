# Development Guide

Reference material reached from [`AGENTS.md`](../AGENTS.md). Everything here is needed only
by some tasks, so it lives outside the always-loaded agent context and behind a pointer.

## Merging

`AGENTS.md` → *Merge Authority* says which rules guard `main`. This is the mechanics.

**Read the blocker before overriding it.** The rulesets are enumerable:

```bash
gh api repos/:owner/:repo/rules/branches/main          # the rules that guard main
gh api repos/:owner/:repo/code-scanning/alerts?state=open   # what the code_scanning rule reads
```

The `code_scanning` rule reads the **base branch's** open alerts, so an alert left on `main`
blocks every merge in the repo — including PRs that touch none of its files. Fix the code, or
dismiss the alert with a written justification:

```bash
gh api -X PATCH repos/:owner/:repo/code-scanning/alerts/<n> \
  -f state=dismissed -f dismissed_reason="false positive" \
  -f dismissed_comment="<why the rule does not apply here>"
```

A dismissal reaches the ruleset evaluation in **minutes**, not seconds. Wait for it; do not
re-dismiss and do not reach for the admin override, which disables the required checks with it.

**Read CI from the head SHA's run.** A push cancels the previous run's jobs, so the superseded
run reports a red `CI` ("Required job(s) were cancelled") while the current run is still
going. That red belongs to a commit that is no longer the head. `gh pr checks <n>` shows the
latest run per check name; the head SHA's run is the one that decides.

**Why a branch goes "behind".** Every merge to `main` triggers `release.yml`, which pushes a
`[skip ci]` version bump onto `main`. A PR opened before that bump is one commit behind, and
a ruleset with a strict status-check policy refuses it ("the head branch is not up to date
with the base branch"). Merge `main` into the branch and let the checks run again — the bump
touches nothing else.

**Merging.** `gh pr merge <n> --merge` is the path; it asks the server and reports the
blocker. The owner can also merge through the API, which returns the same answer:

```bash
gh api -X PUT repos/:owner/:repo/pulls/<n>/merge -f merge_method=merge -f sha=<head sha>
```

## Commands

Scripts live in `package.json` (`pnpm <script>`); this file does not copy the list, because a
copy goes stale. The common ones: `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
`pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`.

## Local runbook

Two commands behave differently than they look. The scripts are pinned by
`src/test/local-runbook.test.ts`: it runs the e2e script with and without a `--` and
requires a listing of the named file, and it requires the env loader to keep the caller's
`DATABASE_URL` and to survive a `.env` line that fails. The `package.json` wiring is pinned
too, so reverting it brings the e2e bug and the `DATABASE_URL` bug back, and this test goes
red. The `--reporter=list` in the test is a code choice, not a pinned invariant: it keeps the
unit suite from rewriting the last real e2e report.

**E2E.** The browser build has to match the Playwright version:

```bash
pnpm exec playwright install chromium     # the installed build drifts from the expected one
pnpm test:e2e e2e/notifications.spec.ts -g "Skill Rating"    # one spec, one test
```

**The seed.** `pnpm db:seed` loads `./.env` for its defaults, and a `DATABASE_URL` you name wins over it:

```bash
DATABASE_URL="file:./seed.db" pnpm prisma migrate deploy
DATABASE_URL="file:./seed.db" pnpm db:seed
```

A throwaway database is the point: the local `prisma/dev.db` drifts behind the migrations, and
the seed then fails on a column that does not exist.

## Dev Server Management (for AI agents)

### Worktree bootstrap

Before running any gate in a **fresh worktree**, run `scripts/worktree-bootstrap.sh`. A
bare `pnpm install` leaves a half-broken tree on this machine (the `better-sqlite3` native
build fails and `.bin` links are missing), and the gitignored Android env files
(`google-services.json`, `local.properties`) do not exist in a worktree, so `:app` builds
fail for environment reasons rather than change reasons. The script is idempotent — rerun
it after any failed gate. `SOURCE=/path/to/healthy/checkout` overrides where it copies
from (defaults to the main worktree).

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

### The shared seams — check here before you write the rule again

A **seam** is the one module that answers a question the whole codebase asks. If you are
about to write a check that reads a field and compares it to a user, an amount, a roster or
a roster size, it almost certainly already exists below. Re-deriving it is how the same bug
ships in fourteen places.

| The question | Reach for | Where you find it |
|---|---|---|
| May this caller **mutate** this Event? | `authorizeEventMutation`, and `eventMutationDenied` for the 403 | `src/lib/eventAuthz.server.ts` |
| May this caller read a **password-protected** Event? | `checkAccess` (owner / invite / cookie token) | `src/lib/eventAccess.ts` |
| May this caller read an Event's **finances**? | `canReadEventFinances` | `src/lib/eventReadAccess.server.ts` |
| How does **money** render? | `formatMoney(cents, currency)`; `toCents` is the one float boundary | `src/lib/money.ts` |
| Who is **active**, who is on the bench, how many spots are left? | `getRosterCapacity` (query) over `splitRoster` (pure) | `src/lib/roster.server.ts`, `src/lib/rosterCapacity.ts` |
| Which **notifications** does this user get? | `resolveJobAudience` per job, then `resolveMuteTier` per user | `src/lib/eventAudience.server.ts`, `src/lib/notificationPrefs.server.ts` |
| How does a **date** render for a locale? | `formatDateInTz` with `dateFormatTag(locale)` | `src/lib/timezones.ts` |
| What does a **payment summary** add up to? | `summarizePayments` | `src/lib/paymentSummary.ts` |

Two traps worth more than the table:

- **`AuthorizableEvent.accessPassword` is required on purpose.** Leave it out of a Prisma
  `select` and it compiles as `undefined`, which reads as "no password" and silently opens a
  locked Event. The type makes that a compile error; keep it that way.
- **Legacy `Player` rows are the wrong source for "who is playing".** They accumulate across a
  recurring Event's occurrences, so a departed member still reads as an active player and the
  ADR 0017 tier-2 mute quietly stops working for them. Membership is the **current Game's
  Roster** (`getRosterCapacity`). This exact mistake was live in the push, FCM and feed paths,
  and was only found by review.

`src/lib/money.ts` is enforced: `no-restricted-syntax` in `eslint.config.js` rejects
`Intl.NumberFormat`, `toFixed(2)` and a literal `€`, and `src/test/money-guardrail.test.ts`
fails if that rule is de-scoped. Money has one format — `50.00€`, two decimals, symbol after
the amount (ADR 0007 keeps the ledger in integer cents).

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

## The two dex ledgers, and the machine exception


| Ledger | Owner | Holds |
|---|---|---|
| **dex** (`.dex/tasks.jsonl`) | Humans | Plans, follow-ups, postmortem actions |
| **GitHub labels + comments** | The factory | Runtime state: queue, Claim, Handoff, Blocked |

`dex` is a local CLI and is **not installed on the GitHub runner**, so machine-written
issues cannot be dex tasks. The one exception to "use dex for ALL task tracking":

> **Explorers and the Sentinel file GitHub issues directly**, labelled `factory:explored`,
> and commit their reasoning to `docs/explorations/`. Humans keep dex.

Agents running an implementation wave: exploration notes go in `docs/explorations/` (one
file per wave), so the next session's implementers and reviewers can read them — `/tmp`
notes die with the machine.

An Explorer never applies `ready-for-agent` to its own issue. Promotion from
`factory:explored` to `ready-for-agent` is the human's decision, always.

## Project structure


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
