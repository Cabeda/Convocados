# 0018 — Organizer automation: escalating nudges, auto-confirm, digest, and quick actions

**Status:** Accepted
**Date:** 2026-06-30

## Context

The notification tier revamp (ADR 0017) established the right-person delivery model. This
ADR addresses the right-time and right-action concerns — specifically automating the
weekly organizer workflow for recurring games so the organizer doesn't need to manually
chase attendance, payments, or replacements.

The organizer's current weekly manual tasks:
1. Ask players to confirm attendance (RSVP ping exists but applies uniformly)
2. Chase players for payment after the game
3. Find replacement players when someone drops out last minute
4. Confirm self-reported payments by checking bank statements
5. Track no-shows mentally

## Decisions

### 1. Escalating payment nudges (3 stages + organizer alert)

Payment reminders escalate in tone and social context:

| Stage | Timing | Message | Audience |
|-------|--------|---------|----------|
| Soft nudge | Game ends (post-game) | "You owe €X — tap to pay" | Debtor only |
| Follow-up | +48h if still pending | "Still pending — €X for [Game]" | Debtor only |
| Social proof | +5 days | "8/10 have paid. You're one of 2 who haven't." | Debtor only |

After stage 3 (no action for 7 days), the system stops nudging the player and notifies
the organizer: "2 players still haven't paid after a week: [names]. Intervene?"

Payment enforcement (`paymentEnforcementLevel`) remains a separate join-time concern.
The nudge escalation is purely a notification concern.

### 2. Auto-confirm attendance (opt-in per event, earned threshold)

When enabled on a recurring event:
- Players who attended the last N consecutive games (default N=3, matches
  `priorityThreshold`) are auto-confirmed for the next occurrence.
- Auto-confirmed players are shown as "confirmed (auto)" — distinct from
  explicit "yes" confirmations.
- The T-48h RSVP ping is suppressed for auto-confirmed players (no noise for regulars).
- A no-show breaks the auto-confirm streak (forced back to explicit RSVP).

Default: **off** per event. Organizer enables it in event settings.

### 3. Organizer daily digest with critical break-through

Organizers can enable digest mode for events they own/admin:
- Tier 2 real-time notifications are suppressed for that event.
- A single daily summary push fires at a configurable time (default: 9 AM
  the day before the game):
  > "Thursday's game: 8/10 confirmed, 2 spots open. €15 pending. Alice sent
  > payment (confirm?)"
- **Critical events still fire in real-time** even in digest mode:
  - Game is now full
  - Last spot opened (someone dropped out)
  - A player self-reported payment (needs organizer confirmation)
  - Game cancelled

Stored as `digestMode: Boolean @default(false)` and `digestTime: String @default("09:00")`
on NotificationPreferences (global) or per-event on EventFollow (future extension).

### 4. Smart last-call (T-24h upgrade + share sheet for organizer)

Rather than adding a third recruitment ping (T-18h), the existing T-24h recruitment
message is upgraded with urgent framing ("TOMORROW — still need N!") and the organizer
receives a companion notification with a share-sheet action:

> "Thursday's game still needs 2 players. [Share invite link]"

The share action generates a pre-written message with game title, location, time, and
join link — ready to paste into WhatsApp/SMS/etc. No third ping to followers.

### 5. Payment self-report → organizer quick-confirm

When a player marks their payment as `sent`:
1. **Immediate push to organizer** with [Confirm] / [Not received] quick actions
   (Android) or action-specific deep link (web: `/events/{id}?action=confirm-payment&player={name}`).
2. No auto-confirm timeout — the organizer confirms manually via the push action.
3. Safety net: unconfirmed `sent` payments (3+ days old) appear in the daily digest
   as an action item.

### 6. Bench position on join

The existing `player_joined_bench` notification is enriched with position:
> "You're #3 on the bench for Thursday's game."

No new notification type — just an enriched body. No movement updates (too noisy).
Promotion notification (existing) fires on actual promotion only.

### 7. No-show tracking (manual, low-prominence)

- Organizer marks no-shows in the game history UI (hidden behind expandable section,
  not shown by default).
- On marking:
  1. Notification to player: "You missed [Game]. No-show streak: N."
  2. Priority penalty applied (existing `noShowStreak` on PriorityEnrollment).
  3. If auto-confirm is enabled, player's streak is broken → forced explicit RSVP next week.
- No auto-detection (too many false positives from team/score entry variations).

### 8. Action-specific deep links for web push

All notification URLs include query params targeting the relevant UI action:

| Notification | URL |
|-------------|-----|
| Payment self-report | `/events/{id}?action=confirm-payment&player={name}` |
| Post-game | `/events/{id}?action=add-score` |
| Recruitment / spots | `/events/{id}?action=join` |
| RSVP | `/events/{id}?action=rsvp` |
| Payment nudge (debtor) | `/events/{id}?action=pay` |

The event page reads `action` from search params and auto-scrolls/opens the
relevant section or dialog. Service worker `notificationclick` already opens the URL.

## Consequences

- Payment reminder cron gains escalation stage tracking (needs a `paymentNudgeStage`
  field or row per player-event pair).
- New Event-level settings: `autoConfirmEnabled`, `autoConfirmThreshold`.
- New NotificationPreferences field: `digestMode`, `digestTime`.
- Organizer digest requires a new cron pass or integration into existing reminder cron.
- The `player_joined_bench` notification body changes (bench position included) — no
  breaking change, just richer content.
- No-show marking requires a new field on GameParticipant or GameHistory snapshot.
- Web event page gains `useEffect` for `action` query param routing.
- Android `NotificationActionReceiver` extended with `ACTION_CONFIRM_PAYMENT`.
