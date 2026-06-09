# 0004 — Per-event notification overrides on EventFollow

**Status:** Accepted  
**Date:** 2026-06-09

## Context

ADR 0003 established EventFollow as the gating condition for notifications — following a game meant receiving all notifications for it. Users who wanted to stay on the dashboard but reduce notification noise had to unfollow entirely, losing dashboard visibility.

Users want granular control: e.g. receive post-game results but not player-join spam for a casual game they follow.

## Decision

Add nullable per-type override columns directly on `EventFollow`:
- `mutePlayerActivity` — player joined/left
- `muteReminders` — pre-game reminders
- `mutePostGame` — post-game results
- `muteEventDetails` — date/location/title changes

Tri-state semantics: `null` = use global default, `true` = suppress, `false` = force-enable.

Additionally, separate `postGamePush` from `gameReminderPush` in `NotificationPreferences` (they were incorrectly coupled).

### Alternatives considered

- **Separate `EventFollowPrefs` table:** More normalized but adds a join per recipient during dispatch. The number of notification types is small (4) and stable — columns on EventFollow are simpler.
- **Simple boolean `muted` flag:** All-or-nothing per game doesn't satisfy the requirement for per-type control.

## Consequences

- Dispatch resolution order: per-event override → global preference → system default.
- Auto-follow (join/claim) creates overrides as all `null` (inherits global).
- UI: bell icon on event detail opens a bottom sheet with per-type toggles.
- API: `GET/PUT /api/events/[id]/follow` extended to include override fields.
- Migration adds 4 nullable columns + 1 new column on NotificationPreferences.
