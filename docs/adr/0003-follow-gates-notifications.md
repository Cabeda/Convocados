# ADR 0003: Follow gates notifications; PushSubscription becomes per-user

## Status
Accepted

## Context
Notifications were delivered based on per-event `PushSubscription` rows (web) and a union of subscribers + linked players + owner (FCM). There was no single concept of "I want updates from this game" — dashboard visibility (`EventFollow`), notification delivery, and participation (`Player`) were conflated in the dispatch logic.

Users had no way to stop notifications from a game without manually unsubscribing each device, and the system couldn't prompt for push permission intelligently because it didn't know who "cared" about a game.

## Decision
1. **`EventFollow` becomes the single gating condition for notifications.** Only followers (+ the owner, who has an implicit permanent follow) receive push notifications. Admins must explicitly follow.

2. **`PushSubscription` is restructured from per-event to per-user.** It becomes a device registry keyed on `[userId, endpoint]`, mirroring how `AppPushToken` already works. The event-level intent lives in `EventFollow`.

3. **Join auto-follows + prompts for push permission.** Quick Join and Claim Player auto-follow the game. At that moment, if the device doesn't have push permission, a native permission prompt is triggered. Declining permission doesn't prevent following.

4. **Soft push prompt on dashboard.** When a user who follows ≥1 game loads the dashboard on a device with no `PushSubscription`, a dismissible banner offers to enable notifications. Cooldown: 30 days after dismissal. Stored in localStorage.

5. **Migration:** Existing `PushSubscription` rows with `userId` generate `EventFollow` records (if missing). Rows are deduplicated to one per `(userId, endpoint)`. Anonymous rows (userId = null, 4 stale records) are dropped.

## Consequences
- A player who joins but later unfollows will NOT receive notifications (explicit opt-out).
- The N×M row explosion (events × browsers) is eliminated.
- Anonymous (pre-sign-in) push subscriptions are no longer supported. Users must be signed in to receive notifications.
- Existing users with web push subscriptions will be migrated to followers automatically — no disruption.
- The dispatch logic simplifies: query `EventFollow` → look up devices for those users → send.
