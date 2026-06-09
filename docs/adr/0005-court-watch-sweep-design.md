# ADR 0005: Court Watch uses single hourly sweep, not per-game scheduled jobs

## Status
Accepted

## Context
We need a background process to check Playtomic for alternative courts matching existing games. Two patterns exist in the codebase:

1. **Per-event ScheduledJob** — used for reminders (24h, 2h, 1h). Each event gets individual rows in `ScheduledJob` with specific `runAt` times.
2. **Single sweep endpoint** — a cron-triggered endpoint that queries all relevant records and processes them in one pass.

Court watching differs from reminders: it's a recurring check (hourly) that runs indefinitely until disabled, rather than a one-shot job tied to a specific time. Using `ScheduledJob` would require self-rescheduling rows (process → create next run → repeat), creating unbounded row growth and complex cleanup.

## Decision
Court Watch uses a **single sweep endpoint** (`/api/cron/court-watch`) triggered externally every hour. The endpoint queries all Events with non-null `courtWatchConfig`, checks Playtomic for each, and creates alerts/notifications for new findings.

Key constraints to protect against Playtomic API abuse:
- Max 20 games with court watch enabled simultaneously
- Max 5 clubs checked per game per sweep (closest by distance)
- 200ms delay between Playtomic API calls
- Alert deduplication via `CourtWatchAlert` table (same tenant+resource+slot not re-notified)

The watch-enabled state is stored as a nullable JSON column (`courtWatchConfig`) on `Event` rather than a separate model. Null = disabled.

## Consequences
- No `ScheduledJob` row management for court watching — simpler lifecycle
- Rate limiting is centralized in one place (the sweep function)
- Adding more watched games is gated by the 20-game cap — prevents runaway API usage
- The sweep must handle partial failures gracefully (one game failing doesn't block others)
- External cron (Fly.io scheduled machine or similar) must be configured to hit the endpoint hourly
