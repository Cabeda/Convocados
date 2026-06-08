# Convocados — Domain Glossary

## Game / Event
A sports match or recurring session. The core entity. Used interchangeably.

## Player
A person registered to participate in a specific Game. Has a `name`, optionally linked to a `User` via `userId`. One user can be a Player in many games. "Joined" now refers strictly to participation (has a linked Player record) — distinct from "followed" which controls dashboard visibility.

## Owner
The User who created the Game or to whom ownership was transferred. Has full management control. A Game has exactly zero or one Owner.

## Admin
A User granted management privileges for a Game by the Owner (via `EventAdmin`). Can edit teams, archive players, approve ELO, etc. Has no ownership rights.

## Follow
An explicit relationship between a User and a Game (stored in `EventFollow`). Following a Game means:
1. It appears on the User's "My games" dashboard.
2. It is the **gating condition** for receiving notifications from that Game — only followers receive push notifications (web + mobile), regardless of which devices are registered.

Distinct from "joined" (participation via Player record). A user can follow without playing, and play without following (though joining prompts a follow).

### Auto-follow rules (user-initiated only)
- Quick Join → auto-follow + prompt for push permission (if not already granted)
- Claim Player → auto-follow + prompt for push permission (if not already granted)
- Auto-link (owner adds, system recognizes user) → no follow
- Owner/admin adds you → no follow

Declining push permission does not prevent following — the user still sees the game on their dashboard, they just won't receive notifications until they grant permission later.

### Push permission prompt (web/iOS)
Triggered on dashboard load when:
1. User follows ≥ 1 game, AND
2. This device has no active PushSubscription, AND
3. User hasn't dismissed the prompt in the last 30 days (tracked in localStorage)

Appears as a dismissible banner/snackbar — never a modal. Accepting triggers the native browser permission dialog. Dismissing stores a timestamp; prompt reappears after 30 days.

## Device Registry
Push notification delivery channels are registered **per user**, not per event:
- `PushSubscription` — web push endpoints (browser/iOS PWA). Keyed on `[userId, endpoint]`.
- `AppPushToken` — FCM tokens (Android app). Keyed on `[userId, token]`.

`EventFollow` is the single source of truth for "who wants notifications for this event." Dispatch queries followers, then looks up their registered devices. This avoids N×M row explosion when a user follows many games.

### Auto-follow rules (user-initiated only)
- Quick Join → follow
- Claim Player → follow
- Auto-link (owner adds, system recognizes user) → no follow
- Owner/admin adds you → no follow

### Auto-unfollow rules
- Self-removal → unfollow
- Event archived → unfollow
- Owner/admin removes you → no unfollow

### Notification dispatch gating
Recipients for event notifications = users who follow the event (`EventFollow`) + the Owner (always, implicit permanent follow). Admins must explicitly follow to receive notifications.

A player who joined but explicitly unfollowed will NOT receive notifications (they opted out of updates while retaining their spot).

## Quick Game
A purely local, ephemeral score-tracking session on Wear OS with interval alarms. Not connected to any server-side Game. Does not sync, has no teams, and does not require authentication. Lost when the user navigates away.

## My games dashboard
Shows games grouped by relationship:
- **Owned** — events where `Event.ownerId = userId`. Always visible. Includes archived.
- **Admin** — events where `EventAdmin.userId = userId`. Always visible. Archived events not shown.
- **Followed** — events where `EventFollow.userId = userId`. Archived events auto-unfollow.

Profile pages (`/api/users/[id]`) continue to show **joined** (participation via Player records), not followed.

## Follow toggle (event detail page)
Authenticated users see a "Following" toggle (bell icon) on the event detail page. Tapping unfollow removes the game from the dashboard and stops notifications. No per-game notification granularity in the dashboard — the push permission banner handles device-level enablement globally.
