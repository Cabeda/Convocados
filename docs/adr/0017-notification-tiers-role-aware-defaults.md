# 0017 — Notification tiers: role-aware defaults and recruitment pings

**Status:** Accepted
**Date:** 2026-06-30

## Context

The existing notification system (ADRs 0003, 0004) treats all Followers equally: everyone
who follows a Game receives all notification types, gated only by global preferences and
per-event mute overrides. In practice this means a Follower who hasn't joined the upcoming
Game receives every player-joined/left push — noise that doesn't concern them and trains
them to ignore notifications entirely.

The goal is: **right person, right time.** Notifications should be relevant to the
recipient's current relationship with the Game.

Additionally, several notification types are missing (game cancelled, game invite push,
bench promoted on capacity increase, payment confirmed, merged post-game + new-list-open),
and there is no mechanism to recruit Followers into under-filled games.

## Decision

### 1. Two notification tiers with role-aware defaults

**Tier 1 — Event-level (all Followers):**
- New game created / list opens (recurring events)
- Event cancelled
- Event details changed (date, location, title of the series)
- Recruitment ping ("few spots left — join now!") at T-48h to non-playing Followers
- 48h recruitment nudge (reuses `muteReminders` as the suppression mechanism)

**Tier 2 — Game-level (Players in the current Game + opted-in Followers):**
- Player joined / left / bench promoted
- Game full
- Spot available (someone left)
- Post-game (merged with "new list open" for recurring events)
- Payment reminders
- Game reminders (24h, 2h)

### 2. Resolution logic change

The existing `wantsPushWithOverrides` resolution is:

```
per-event override → event admin default → global preference
```

A new step is inserted between "event admin default" and "global preference":

```
per-event override → event admin default → role-based default → global preference
```

**Role-based default:** when the override is `null` and event-default is `null`:
- If the user is a **Player** (active GameParticipant) in the current Game → unmuted (receives Tier 2)
- If the user is **not a Player** → muted for Tier 2 types (receives only Tier 1)

This means:
- A non-Player Follower sees only event-level notifications by default
- Setting `mutePlayerActivity: false` (force-enable) on the EventFollow opts them into game-level — this is the "full notifications" path
- The UI provides a single-tap shortcut to force-enable all Tier 2 types

### 3. No new schema columns for the tier mechanism

The existing nullable mute flags on `EventFollow` are sufficient:
- `null` = role-aware default (Players get it, non-Players don't)
- `false` = force-enable regardless of role
- `true` = force-mute regardless of role

### 4. Post-game merged with new-list-open

The `post_game` notification type absorbs the "new game created" signal. For recurring
events the message includes a "join next game" CTA. For non-recurring events it's just
"add scores, settle payments." Single notification, single tap target.

### 5. Recruitment ping

A new notification sent at T-48h to non-playing Followers when the game has fewer than
`recruitmentThreshold` spots filled (i.e., spots remaining > threshold). Threshold is
configurable per-event (stored on Event, default 3). Gated by `muteReminders` (no new
mute flag). Not sent if the game is already full.

### 6. "Few spots left" event-level notification

Distinct from `spot_available` (game-level, fires when someone leaves). This fires when
the number of remaining spots drops to ≤ `recruitmentThreshold` and notifies non-playing
Followers: "Only N spots left for Friday Futsal — join now!" Tier 1 (event-level).

### 7. Admin auto-follow

Granting Admin rights auto-follows the event with all notifications enabled (full
notifications = Tier 1 + Tier 2, i.e., all mute flags set to `false`). Admins can dial
down like anyone else.

### 8. Owner notification control

The Owner retains implicit permanent follow (cannot unfollow) but gains the same per-event
override toggles as any Follower. Default: all unmuted. The Owner can mute individual
types but cannot unfollow.

### 9. New notification types

| Type | Tier | Trigger |
|------|------|---------|
| `game_cancelled` | 1 | Owner/Admin cancels or deletes a Game |
| `game_invite` | 1 | Player added to event by Owner/Admin (wires up existing `gameInvitePush` pref) |
| `bench_promoted_capacity` | 2 | maxPlayers increased, bench players move to active |
| `payment_confirmed` | 2 | Payment marked as received by Owner/Admin |
| `recruitment` | 1 | T-48h ping to non-playing Followers when game not full |
| `few_spots_left` | 1 | Spots remaining ≤ recruitmentThreshold, sent to non-playing Followers |

The existing `spot_available` remains Tier 2 (fires when someone leaves, sent to Players + opted-in Followers).

### 10. Dropped / deferred

- `weeklySummaryEmail` — either wire up or remove the dead preference (deferred to separate task)
- `reminder1h` — kept as a power-user toggle, removed from default settings UI
- Quiet hours / timezone-aware delivery hold — deferred (meaningful but separate concern)

## Alternatives considered

1. **New `notificationTier` enum column on EventFollow** — explicit but redundant with the mute flags. Adds a migration and a sync problem (tier says "event" but mute flags say "force-enable player activity" — which wins?).

2. **New `fullNotifications` boolean on EventFollow** — simpler than an enum but still a new column that duplicates what the mute flags already express. The role-aware default achieves the same without new state.

3. **Separate `muteRecruitment` flag** — adds a 5th mute dimension for a single notification. Recruitment is functionally a reminder to non-players; reusing `muteReminders` keeps the model compact.

## Consequences

- The `wantsPushWithOverrides` function gains a `isPlayerInCurrentGame: boolean` parameter. Callers must resolve this before dispatch.
- Dispatch for game-level notifications must check GameParticipant membership (already queried for most notification paths).
- The UI bell bottom-sheet gains a "Get all updates" shortcut that writes all mute flags to `false`.
- Event model gains `recruitmentThreshold: Int? @default(3)`.
- Admin grant flow must create an EventFollow with all mute flags set to `false`.
- Existing Followers (non-Players) will stop receiving game-level notifications after deployment — this is intentional noise reduction but should be communicated via a one-time in-app notice.
