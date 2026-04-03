# Implementation TODO

## Infrastructure hardening
- [ ] #126 — React component tests with Vitest + Testing Library
- [ ] #127 — Persistent rate limiting backed by SQLite

## Open issues (from scope review)
- [ ] #260 — CSRF posture review — `checkOrigin: false` disables protection for all routes
- [ ] #261 — Add `push.server.ts` to test coverage
- [ ] #262 — `redirectUrls` format inconsistency (comma-separated vs JSON array)
- [ ] #263 — Dockerfile doesn't account for pnpm workspace
- [ ] #264 — Stale push token cleanup
- [ ] #265 — Real `google-services.json` for FCM in CI
- [ ] #266 — APK signing for release workflow
