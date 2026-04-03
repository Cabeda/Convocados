# Implementation TODO

## Existing branches (review, test, fix, PR, merge)
- [x] #54 — PWA icons (PR #81 ✅ merged)
- [x] #57 — OpenAPI 3.1 spec (PR #82 ✅ merged)
- [x] #58 — Webhook v2 (PR #83 ✅ merged)
- [x] #62 — API keys (PR #84 ✅ merged)
- [x] #64 — More languages (PR #85 ✅ merged)
- [x] #71 — SEO public games (PR #86 ✅ merged)

## New features implemented (TDD)
- [x] #55 — Email notifications (PR #87 ✅ merged)
- [x] #50 — Scheduled game reminders (PR #88 ✅ merged)
- [x] #66 — Real-time updates via SSE (PR #89 ✅ merged)
- [x] #68 — Admin dashboard (PR #90 ✅ merged)

## Recently completed
- [x] #93 — Redirect to event page after login (PR #99 ✅ merged)
- [x] #95 — Touch-friendly team picker (PR #98 ✅ merged)
- [x] Max players input fix — allow empty field, validate on submit (PR #100 ✅ merged)
- [x] Increase max players limit from 30 to 100 (PR #100 ✅ merged)
- [x] Enable all available languages in language toggle (PR #100 ✅ merged)
- [x] Teams only use active players (not bench) — test added (PR #100 ✅ merged)

## Final verification
- [x] All 463 tests pass on merged main
- [x] All PRs merged to main

## Infrastructure hardening (in progress)
- [x] #123 — SQLite production hardening (PR #128 ✅ merged)
- [x] #124 — Structured logging (PR #129 ✅ merged)
- [x] #125 — E2E tests with Playwright
- [ ] #126 — React component tests with Vitest + Testing Library
- [ ] #127 — Persistent rate limiting backed by SQLite

## CI migration to pnpm + incremental typecheck (#197)
- [x] Enable incremental type checking with tsBuildInfoFile
- [x] Migrate test.yml (ci, e2e, lighthouse) from npm to pnpm
- [x] Migrate release.yml from npm to pnpm
- [x] Migrate deploy.yml from npm to pnpm
- [x] Migrate performance.yml from npm to pnpm
- [x] Remove redundant install+test in deploy jobs
- [x] Share build artifacts between ci → e2e/lighthouse
- [x] Delete stale package-lock.json
- [x] Create PR and merge (PR #198 ✅ merged)
- [x] Verify deployment succeeds (v3.37.0 deployed, health check OK)

---

## Mobile app — feature parity with web

### P0 — Blocks core workflows (implement first)
- [x] **Locked event / password prompt** — event detail handles `locked: true`; password entry screen before showing event
- [x] **Event settings page** — owners/admins can edit title, location, max players, sport, toggle public/ELO/split costs, set/remove password, archive; links to rankings/payments/log
- [x] **Post-game banner** — fetches `/api/events/:id/post-game-status` after load; shows record score + mark payments CTAs when game ended

### P1 — High value, missing entirely
- [x] **Public games page** — browse/join public events via `GET /api/events/public`; accessible from Games tab (🌍 button); paginated
- [x] **Rankings / ELO leaderboard** — per-event ratings via `GET /api/events/:id/ratings`; accessible from event detail (🏆) and settings; paginated
- [x] **Payment tracking** — record who paid via `GET/PUT /api/events/:id/payments`; accessible from event settings and post-game banner; tap to toggle paid/pending
- [x] **Notification preferences** — `GET/PUT /api/me/notification-preferences`; accessible from Profile tab; full push + email + timing toggles

### P2 — Improves existing screens
- [x] **History pagination** — event detail loads more history using `hasMore`/`nextCursor`
- [x] **Games tab pagination** — `ownedHasMore`/`joinedHasMore` cursors used; "Load more" button
- [x] **Recurrence badge on game cards** — 🔁 shown on recurring `EventSummary` cards
- [x] **Event detail: settings button** — owners/admins see ⚙️ in action bar; navigates to settings screen

### P3 — Nice to have
- [x] **User profile pages** — view other players' stats via `GET /api/users/:id` + `GET /api/users/:id/stats`; accessible at `/user/:id`
- [x] **Event log** — audit trail via `GET /api/events/:id/log`; accessible from event settings; paginated
- [x] **Attendance stats page** — dedicated screen for attendance breakdown at `/event/:id/attendance`; accessible from event settings
- [x] **Calendar export** — share `.ics` link from event detail via `/event/:id/calendar`; accessible from event settings
- [x] **Recurrence settings in create** — weekly/monthly recurrence picker in advanced options of create event screen
