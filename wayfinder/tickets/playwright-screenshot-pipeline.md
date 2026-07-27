# Prototype: Playwright screenshot pipeline for all routes

**Type:** prototype (HITL)
**Labels:** wayfinder:prototype
**Blocked by:** none

## Question

What does the Playwright script look like that iterates all routes, handles auth, seeds data, and produces organized screenshot output?

...

## Resolution

Script at `scripts/screenshots.ts`, run via `npm run screenshots`. Produces 16 screenshots in `screenshots/`. Handles auth via demo user login, discovers event IDs via `/api/events/public`. Configurable via `UI_REVIEW_URL` and `UI_REVIEW_DIR` env vars. Verified on dev server with seed data — all 16 pages captured including auth-gated ones.

Close this ticket.
