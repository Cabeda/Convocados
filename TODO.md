# Implementation TODO

## Push notification fixes (critical)
- [x] Fix #3 — prefsMap in sendPushToEvent only loads prefs for web push users, not mobile-only users
- [x] Fix #2 — await enqueueNotification before drainNotificationQueue to avoid race
- [x] Fix #4 — sender self-notification on mobile (no clientId sent from mobile app)
- [x] Fix #5 — notification tap deep linking (tapping notification does nothing)
- [x] Fix #6 — push body always English, ignores user locale
- [x] Fix #7 — token refresh on app resume (only runs on auth change)

## Infrastructure hardening
- [ ] #126 — React component tests with Vitest + Testing Library
- [ ] #127 — Persistent rate limiting backed by SQLite

## Open issues (from scope review)
- [ ] #260 — CSRF posture review — `checkOrigin: false` disables protection for all routes
- [ ] #261 — Add `push.server.ts` to test coverage
- [ ] #262 — `redirectUrls` format inconsistency (comma-separated vs JSON array)
- [x] #263 — Dockerfile doesn't account for pnpm workspace
- [ ] #264 — Stale push token cleanup
- [ ] #265 — Real `google-services.json` for FCM in CI
- [ ] #266 — APK signing for release workflow

## Wear app testing

### Unit tests (local JVM — `./gradlew :wear:testDebugUnitTest`)
- [x] `DateTimeUtilTest` — parseInstant (zoned, UTC, garbage), formatRelativeTime (in progress, minutes, hours, past, unparseable)
- [x] `WearGameRepositoryTest` — refreshGames, refreshHistory, submitScore (online + offline queue), syncPendingScores (success + retry), observeGames, observePendingCount, getGame
- [x] `GamesViewModelTest` — initial state, loading games, offline flag, pending sync count, suggested game selection, refresh
- [x] `ScoreViewModelTest` — initial state, load, idempotent load, increment/decrement both teams, floor at zero, save, save without history

### Integration tests (androidTest — `./gradlew :wear:connectedDebugAndroidTest`)
- [x] `WearGameDaoTest` — insertAll sorted by dateTime, refreshGames atomic per type, getGame by id, upsert on conflict
- [x] `WearHistoryDaoTest` — getLatestHistory DESC, observeLatestHistory emits, refreshHistory replaces per event, updateScore in place
- [x] `PendingScoreDaoTest` — insert/getAll ordered, delete specific, observeCount, incrementRetry, deleteStale at retryCount >= 5
- [x] `WearTokenStoreTest` — round-trip tokens, clearTokens, isExpired (future/buffer/past), server URL get/set/switch, isAuthenticated StateFlow
- [x] `WearApiClientIntegrationTest` — fetchMyGames, field validation, fetchHistory, unauthenticated 401 (configurable backend via instrumentation args)

### E2E tests (androidTest — require emulator + running backend)
- [x] `ScoreUpdateE2ETest` — sign in via email → get OAuth token via mobile-callback → fetch games → cache in Room → pick game → fetch history → update score → verify on backend → verify in local Room DB → verify no pending scores

#### Running E2E tests against local backend:
```bash
./gradlew :wear:connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.e2e.ScoreUpdateE2ETest \
    -Pandroid.testInstrumentationRunnerArguments.backendUrl=http://10.0.2.2:4321 \
    -Pandroid.testInstrumentationRunnerArguments.testEmail=test@example.com \
    -Pandroid.testInstrumentationRunnerArguments.testPassword=TestPassword123
```

#### Running E2E tests against production:
```bash
./gradlew :wear:connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.e2e.ScoreUpdateE2ETest \
    -Pandroid.testInstrumentationRunnerArguments.backendUrl=https://convocados.cabeda.dev \
    -Pandroid.testInstrumentationRunnerArguments.testEmail=<your-email> \
    -Pandroid.testInstrumentationRunnerArguments.testPassword=<your-password>
```

### Remaining E2E tests (require Wear OS emulator UI automation)
- [ ] Auth flow — launch WearActivity, tap "Server Settings", switch to local backend, tap "Skip to Games (Local Dev)", verify navigation lands on GamesScreen
- [ ] Games list — after auth bypass, verify GamesScreen shows games fetched from `http://10.0.2.2:4321/api/me/games`, verify the suggested game chip is highlighted
- [ ] Offline score queue — enable airplane mode, enter a score, verify "Will sync when online" message, disable airplane mode, verify pending sync count drops to 0
- [ ] Backend switching — on AuthScreen, toggle between Prod and Local, verify the displayed URL updates and persists across app restart
