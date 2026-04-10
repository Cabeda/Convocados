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
