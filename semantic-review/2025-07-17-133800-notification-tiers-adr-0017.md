# Two-tier notification system with role-aware defaults (ADR 0017)

This change introduces a two-tier notification architecture: Tier 1 (event-level, broadcast to all followers) and Tier 2 (game-level, only players + opted-in followers). Six new notification types are added (game_cancelled, game_invite, bench_promoted_capacity, payment_confirmed, recruitment, few_spots_left), the 48h gate on spot_available is removed, recruitment pings fire at T-48h for non-full games, a merged post_game message handles recurring events, admin auto-follow with full notifications is added, and the UI gets preset shortcuts for notification granularity. The resolution logic gains a 5th parameter (`isPlayerInCurrentGame`) that gates Tier 2 delivery.

**Watch for:** (1) Recruitment cron is dead on arrival due to a query timing bug [confirmed]; (2) `few_spots_left` can fire repeatedly with no dedup [confirmed]; (3) several push paths bypass i18n, sending hardcoded English [confirmed]; (4) direct `sendPushToUser` calls in payments/sport skip tier-aware resolution [confirmed].

## High-level view

The core resolution logic in `notificationPrefs.server.ts` is well-structured and the test suite (54 tests) covers the combinatorial space of tier x role x override exhaustively.

The fan-out path in `push.server.ts` correctly resolves player membership and routes through tier-aware resolution. However, several new notification types are sent via `sendPushToUser` directly (payment_confirmed, bench_promoted_capacity, game_invite), which means they only check global prefs — not per-event overrides or role-based tier filtering.

The recruitment cron block has a fatal sequencing bug: it calls `getEventsNeedingRsvpPing()` after the RSVP block has already marked those events as `rsvpCutoffSent: true`, so the query returns empty and no recruitment pings are ever sent.

The `few_spots_left` notification fires on every player add while `spotsLeft <= recruitmentThreshold`, meaning if threshold is 3 and players join one at a time, followers receive up to 3 sequential notifications with no dedup.

<details>
<summary>Issues (7)</summary>

1. **Recruitment cron never fires** — `getEventsNeedingRsvpPing()` is called after the RSVP block marks events with `rsvpCutoffSent: true`. Either query events before the RSVP block, use a separate flag, or inline the query with a different filter.
2. **few_spots_left has no dedup** — fires on every player add while spots remain <= threshold. Add a `fewSpotsLeftSent` flag on the event (or in ReminderSent) and reset it when a player leaves.
3. **payment_confirmed bypasses tier-aware resolution** — `sendPushToUser` in payments.ts/bulk.ts only checks global prefs (`playerActivityPush`), not per-event overrides or the mute flags. Should route through `enqueueNotification` + queue drain, or at minimum call `wantsPushWithOverrides`.
4. **bench_promoted_capacity bypasses tier-aware resolution** — same issue in sport.ts: `sendPushToUser` skips per-event overrides.
5. **game_invite bypasses tier-aware resolution** — `sendPushToUser` in players.ts checks `gameInvitePush` directly, not `wantsPushWithOverrides`. Per-event `muteEventDetails` override is ignored.
6. **Hardcoded English in push messages** — payment_confirmed, bench_promoted_capacity, game_invite, and recruitment cron all send English strings. These should use the user's locale via `createT(locale)` or the localized `key` param approach.
7. **`as any` type casts on i18n keys** — `"notifyGameCancelled" as any`, `"notifyFewSpotsLeft" as any`, `pgKey as any` in scheduler.ts. These keys exist in en.ts but the TranslationKey type hasn't been updated to include them.

</details>

<details>
<summary>Details</summary>

## Recruitment cron query timing

The cron handler processes RSVP pings first (line ~215), iterating over `getEventsNeedingRsvpPing()` results and calling `markRsvpCutoffSent(e.id)` for each. The recruitment block (line ~262) then calls the same function again:

```typescript
const rsvpEvents2 = await getEventsNeedingRsvpPing();
```

But `getEventsNeedingRsvpPing` filters on `rsvpCutoffSent: false`. Since the previous block already flipped those to `true`, this second call always returns an empty array. The recruitment feature is dead code in production. Fix: capture the event list once before the RSVP block and share it, or add a dedicated `recruitmentPingSent` flag on Event.

## few_spots_left repeated delivery

In `players.ts`, the condition `spotsLeft > 0 && spotsLeft <= (event.recruitmentThreshold ?? 3) && !isOnBench` triggers on every active-list player addition while the game is near-full. For a game with maxPlayers=10 and threshold=3, adding the 8th, 9th, and 10th player each fires a `few_spots_left` notification to all followers. This creates notification fatigue — the classic "crying wolf" pattern.

A single boolean flag `fewSpotsLeftNotified` on Event (reset when a player leaves) would ensure it fires once per "approaching full" phase.

## Direct sendPushToUser skips tier-aware resolution

Three new notification paths bypass `sendPushToEvent` / the notification queue:

- **payments.ts** (line 128): checks `prefs.pushEnabled && prefs.playerActivityPush` directly
- **payments/bulk.ts** (line 49-55): same pattern, looping N players
- **sport.ts** (line 46): checks `prefs.pushEnabled && prefs.playerActivityPush`

None of these call `wantsPushWithOverrides`, so a player who has `mutePlayerActivity: true` on their EventFollow would still receive payment_confirmed and bench_promoted pushes. The fix is either routing through `enqueueNotification` (preferred — gets queue batching and dedup for free) or calling `wantsPushWithOverrides` with the user's per-event overrides.

## Hardcoded English in push bodies

The recruitment cron sends:
```typescript
`📢 ${event.title} still needs ${spotsLeft} player(s) — join now!`
```

Payments sends `✅ Your payment for ${event.title} has been confirmed`, and sport.ts sends `🎉 You've been promoted to the active list!`. These are always English regardless of the user's locale. The i18n keys (`notifyPaymentConfirmed`, `notifyBenchPromotedCapacity`, `notifyRecruitment`) already exist in all 6 locale files, but these `sendPushToUser` call sites don't use them.

## Admin auto-follow resets existing preferences on re-grant

In `admins.ts`, the auto-follow upsert unconditionally sets all mute flags to `false` (force-enable). If an existing admin had deliberately muted certain categories, granting admin again (re-grant scenario) resets their preferences without warning. Consider using `create` without the `update` block, or only setting overrides if they're currently `null`.

## Test coverage gaps

Not tested:
- The recruitment cron path (and the query timing bug)
- `few_spots_left` dedup behavior (or lack thereof)
- Admin auto-follow overriding existing EventFollow preferences
- `sendPushToUser` calls in payments/sport respecting (or not) per-event overrides
- The "event_only" preset behavior when user is a Player (they'd lose Tier 2 until they manually re-enable or the queue passes `isPlayerInCurrentGame=true` — but `sendPushToUser` paths won't)

</details>

<details>
<summary>File map</summary>

| File | Change |
|------|--------|
| `src/lib/notificationPrefs.server.ts` | Tier classification set, `isGameLevelNotification()`, role-aware 5th param in `wantsPushWithOverrides`, new types in switch statements |
| `src/lib/notificationQueue.server.ts` | 6 new `NotificationJobType` union members |
| `src/lib/push.server.ts` | Active player lookup for tier filtering, `playerUserIds` option threaded through, `type` field in FCM data payload |
| `src/lib/leave.server.ts` | Removed 48h gate on spot_available, now fires for any future game |
| `src/lib/scheduler.server.ts` | Recurring-aware message key for post_game |
| `src/pages/api/cron/reminders.ts` | Recurring post-game key, recruitment ping block (buggy) |
| `src/pages/api/events/[id]/archive.ts` | game_cancelled notification on archive |
| `src/pages/api/events/[id]/players.ts` | game_invite push, few_spots_left trigger |
| `src/pages/api/events/[id]/sport.ts` | bench_promoted_capacity on maxPlayers increase |
| `src/pages/api/events/[id]/payments.ts` | payment_confirmed push for single payment |
| `src/pages/api/events/[id]/payments/bulk.ts` | payment_confirmed push for bulk mark-paid |
| `src/pages/api/events/[id]/admins.ts` | Auto-follow with full notifications on admin grant |
| `src/pages/api/events/[id]/follow.ts` | Preset shortcuts ("all" / "event_only") |
| `src/pages/api/events/[id]/known-players.ts` | PlayerRating fallback (unrelated to notifications) |
| `src/components/event/NotifyButton.tsx` | Preset button group in bell popover |
| `prisma/schema.prisma` | `recruitmentThreshold` field on Event |
| `src/lib/i18n/{en,pt,es,fr,de,it}.ts` | New i18n keys for all 6 notification messages + presets |
| `android-app/.../ConvocadosFcmService.kt` | Channel routing for all new types + CHANNEL_EVENT_UPDATES |
| `android-app/.../NotificationPrefsScreen.kt` | `postGamePush` toggle + tier explanation card |
| `android-app/.../Models.kt` | `postGamePush` field |
| `src/test/notification-tiers.test.ts` | 54 tests covering tier classification and role-aware resolution |
| `src/test/notificationPrefs.test.ts` | Tests for `isGameLevelNotification` and `wantsPushWithOverrides` with 5th param |
| `src/test/leave.test.ts` | Updated test to expect spot_available outside 48h |

[Full diff: `git diff main`]

</details>
