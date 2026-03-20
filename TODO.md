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
- [ ] #123 — SQLite production hardening (WAL, Litestream, busy_timeout)
- [ ] #124 — Structured logging, error tracking, APM observability
- [ ] #125 — E2E tests with Playwright
- [ ] #126 — React component tests with Vitest + Testing Library
- [ ] #127 — Persistent rate limiting backed by SQLite
