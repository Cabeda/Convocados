# Convocados — Domain Glossary

## Event
A recurring series or one-off template. Holds configuration (title, location, sport, maxPlayers, recurrence rule, payment settings, priority settings). The container for one or more Games. URL: `/events/:id`.
_Avoid_: game (when referring to the series)

## Game
A single occurrence of an Event — one date, one player list, one score. The unit of participation: Players join a Game, RSVPs answer a Game, payments settle a Game. A non-recurring Event has exactly one Game. A recurring Event spawns a new Game on each recurrence cycle.

A Game has a lifecycle: `upcoming → in_progress → played | cancelled`. Transitions are lazy (triggered on first GET after the time condition is met).
_Avoid_: event (when referring to a single occurrence), instance, occurrence (code uses `Game` exclusively)

## Friendly Game
A Game marked with `isFriendly: true` by the Owner/Admin. Friendly Games are excluded from ELO calculations. All other mechanics (attendance, payments, MVP voting, stats counting) remain unchanged. Settable at any time — before, during, or after the Game. Toggling retroactively triggers ELO reprocessing for the Event.

Use cases: casual sessions with guests, holiday matches, unbalanced rosters, first-timer introductions.
_Avoid_: exhibition, practice, scrimmage

## Player
A participation record in a specific **Game** (via `GameParticipant`). The per-game row that tracks order/position. Linked to an **EventPlayer** (the persistent series identity). "Joined" means having a GameParticipant record in the current Game.

## EventPlayer
The persistent identity of a participant within an **Event** series. One per person per Event. Holds the name, optional `userId` link, cached ELO rating, and win/loss/attendance counters. Either anonymous (name-keyed, no userId) or authenticated (userId-linked).

Anonymous EventPlayers can be **claimed** by an authenticated User, inheriting all history. Claim is blocked if any Game overlap exists between the two identities.

EventPlayer.name is mutable (owner/admin can rename for typo fixes or disambiguation). Name changes do not propagate to historical denormalized fields (GamePayment.playerName, MvpVote names capture the name at time of write).

_Avoid_: PlayerRating (absorbed into EventPlayer), series player

## Owner
The User who created the Game or to whom ownership was transferred. Has full management control. A Game has exactly zero or one Owner.

## Admin
A User granted management privileges for a Game by the Owner (via `EventAdmin`). Can edit teams, archive players, approve ELO, etc. Has no ownership rights.

## Follow
An explicit relationship between a User and a Game (stored in `EventFollow`). Following a Game means:
1. It appears on the User's "My games" dashboard.
2. It is the **gating condition** for receiving notifications from that Game — only followers receive push notifications (web + mobile), subject to per-event overrides and notification tiers.

Each `EventFollow` carries nullable per-type override columns (`mutePlayerActivity`, `muteReminders`, `mutePostGame`, `muteEventDetails`). Tri-state semantics with **role-aware defaults**:
- `null` — use role-based default: **Players** (active GameParticipant in the current Game) receive game-level notifications; **non-Players** do not. Falls through to global preference only for event-level types.
- `true` — suppress this notification type for this game regardless of role or global setting
- `false` — force-enable this type for this game regardless of role (this is how a non-Player opts into game-level notifications)

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
Recipients for event notifications = users who follow the event (`EventFollow`) + the Owner (always, implicit permanent follow). Admins auto-follow when granted admin rights (with full notifications enabled by default).

Notifications are split into two tiers:

**Tier 1 — Event-level (all Followers):**
- New game created / list opens
- Event cancelled
- Event details changed (date/location/title)
- Recruitment ping (T-48h to non-playing Followers when game not full)
- "Few spots left" (spots remaining ≤ `recruitmentThreshold`)
- Game invite (player added by Owner/Admin)

**Tier 2 — Game-level (Players + opted-in Followers):**
- Player joined / left / bench promoted
- Game full / spot available
- Game reminders (24h, 2h)
- Post-game (merged with "new list open" for recurring events)
- Payment reminders / payment confirmed

Resolution order for each notification type:
1. Per-event override on `EventFollow` (if not null, wins)
2. Event admin default (if set)
3. Role-based default: Player in current Game → unmuted for Tier 2; non-Player → muted for Tier 2
4. Global user preference from `NotificationPreferences`
5. System default (all push enabled)

A non-Player Follower who wants game-level notifications sets their mute overrides to `false` (force-enable). The UI provides a "Get all updates" shortcut for this.

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
Authenticated users see a bell icon on the event detail page:
- **Bell filled** — following with notifications on (per global defaults)
- **Bell outline** — not following

Tapping the bell when not following → follows the event. Tapping when already following opens a **bottom sheet** with per-type toggles:
- Player activity (joins/leaves)
- Game reminders
- Post-game results
- Event changes (date/location/title)

Each toggle shows the effective state (resolved from per-event override or global default). Changing a toggle writes the per-event override. An "Unfollow" action at the bottom of the sheet removes the follow entirely.

## Notification Tier
The classification of a notification type by intended audience scope. Two tiers exist:

**Tier 1 (Event-level)** — delivered to all Followers of the Event. Concerns the series/event as a whole: new game created, event cancelled, event details changed, recruitment pings, few-spots-left alerts, game invites.

**Tier 2 (Game-level)** — delivered only to Players in the current Game and Followers who have explicitly opted in (by setting mute overrides to `false`). Concerns a specific Game occurrence: player activity, game full, spot available, reminders, post-game, payment notifications.

The tier is a property of the notification type, not a user setting. Users control what they receive via mute overrides on EventFollow.
_Avoid_: notification level, notification category (overloaded)

## Recruitment Threshold
A per-Event integer (`recruitmentThreshold`, default 3) controlling two event-level notifications:
1. **Recruitment ping** (T-48h): sent to non-playing Followers when the game has more than `recruitmentThreshold` spots remaining.
2. **Few-spots-left alert**: sent to non-playing Followers when remaining spots drop to ≤ `recruitmentThreshold`.

Configurable by the Owner. Set to 0 to disable recruitment notifications entirely.
_Avoid_: fill threshold, capacity warning

## Auto-Confirm Attendance
An opt-in per-Event setting (`autoConfirmEnabled`, default off) that automatically confirms regulars for the next Game occurrence without requiring explicit RSVP.

A player earns auto-confirm status by attending N consecutive games (N = `autoConfirmThreshold`, default 3). Auto-confirmed players are shown as "confirmed (auto)" and do not receive the T-48h RSVP ping. A no-show breaks the streak, forcing explicit RSVP for the next game.

Only applies to recurring Events. The Owner enables it in event settings.
_Avoid_: auto-RSVP, assumed attendance

## Payment Nudge Escalation
A 3-stage automatic reminder sequence for unpaid debts, replacing the flat daily reminder:

1. **Soft nudge** (game ends): "You owe €X — tap to pay"
2. **Follow-up** (+48h): "Still pending — €X for [Game]"
3. **Social proof** (+5 days): "8/10 have paid. You're one of 2 who haven't."

After stage 3, the system stops nudging the debtor and alerts the Organizer: "2 players haven't paid after a week." The Organizer intervenes manually from there.

Tracked per (Event, Player) pair. Distinct from `paymentEnforcementLevel` (join-time gate).
_Avoid_: payment escalation ladder, dunning

## Organizer Digest
A daily summary notification replacing real-time Tier 2 pushes for event Owners/Admins who opt in (`digestMode`, default off). Fires at a configurable time (`digestTime`, default "09:00") the day before the game.

Contents: attendance count, open spots, pending payments, actions needed (e.g., confirm self-reported payments).

**Critical break-through events** still fire in real-time regardless of digest mode: game full, last spot opened, payment self-reported (needs confirmation), game cancelled.
_Avoid_: batch notification, summary mode

## No-Show
A Game participation record where the player was confirmed but did not attend. Marked manually by the Organizer in the game history UI (hidden behind expandable section, not shown by default).

Consequences: notification to the player with streak count, priority enrollment penalty (`noShowStreak` on PriorityEnrollment), and broken auto-confirm streak (forces explicit RSVP next week).

No automatic detection — manual marking only to avoid false positives.
_Avoid_: absence, missed game (overloaded with Wallet credit context)

## Court Alternative
A Playtomic court slot that matches an existing Game's dateTime (±30 min), sport, and minimum duration, offered as a replacement option. Surfaced to Owner/Admins only — either via manual search or an automated hourly background sweep ("Court Watch"). Filtered by distance from the Game's coordinates, and optionally by indoor/outdoor and surface type (best-effort, dependent on Playtomic data availability). When accepted ("Switch"), the Game's location and coordinates are updated and all Followers are notified via the standard event-details-changed flow.

## Court Watch
An opt-in background process that checks Playtomic hourly for Court Alternatives matching a Game's criteria. Enabled per-game by an Admin via a JSON config (`courtWatchConfig`) on the Event. Requires the Event to have latitude/longitude. Alerts are deduplicated — the same slot is never re-notified. Watching stops only when the Admin disables it.

## Outstanding Balance ("tab")
The total amount an **EventPlayer** still owes within an Event series, computed by summing unpaid `GamePayment` rows across all Games for that EventPlayer. Scoped **per-Event, per-EventPlayer** — it does not span Events.

A balance is only attributable to a person (and therefore eligible to drive a personal payment nudge) when the EventPlayer is linked to a `User` (authenticated). For anonymous EventPlayers, the balance is informational only — surfaced to the Owner/Admin, never as a personal nudge.

## Payment status lifecycle
A `PlayerPayment` (and each entry in a `GameHistory.paymentsSnapshot`) moves through:
- **pending** — owed, no action taken. Counts toward the Outstanding Balance.
- **sent** — the Player has self-reported paying (e.g. tapped "Pay & join" and confirmed they sent the transfer). Still counts toward the balance — the debt is not cleared until confirmed. Only the Player acting on their own behalf may move `pending → sent`.
- **paid** — the Owner/Admin has confirmed receipt. The only status that clears the balance. Only Owner/Admin may set `paid` (and may move `sent → paid` or `pending → paid` directly).

The Owner/Admin remains the single source of truth for money actually received; `sent` is a courtesy signal that gives the payer closure and gives the organizer a "confirm received" worklist. It never auto-promotes to `paid`.

## Historical Settlement
A `WalletTransaction` row with `reason = "payment_received"` and a non-null `gameHistoryId` linking it to a specific frozen `GameHistory.paymentsSnapshot` entry. The act of recording that an Owner/Admin has confirmed receipt of money for a historical game, even though the snapshot still says `pending`. The read path nets Historical Settlements against the snapshot-derived Outstanding Balance, so the per-game status is effectively `paid` without mutating the frozen snapshot. Idempotent on `(gameHistoryId, userId)`. Owner/Admin only. ADR 0019.
_Avoid_: historical payment, retroactive payment, settle past

## Payment Matrix
The per-player × per-game grid rendered on the **Payments** tab of `/events/[id]/settle`. Shows the frozen `GameHistory.paymentsSnapshot` status for every (player, historical game) pair, netted against any Historical Settlement, with one-click Owner/Admin actions to record a settlement. Inspired by settleup.app's per-activity entry list. The canonical place to see money state across the whole event in one view.
_Avoid_: payments grid, activity feed (already used for a per-user ledger view), all-payments view

## Ghost User
A real `User` row with `id = "ghost:{eventPlayerId}"` and email
`ghost-{eventPlayerId}@system.local`, created during the
Player → EventPlayer backfill (ADR 0019) for legacy players without
a `userId`. The synthetic id is stable across renames of the
`EventPlayer.name` because the read path joins on `userId`, not on
name. The original-name drift problem (e.g. `Gonçalo` vs `Gonçalo
Silva` in the same event) is fixed at the source. ADR 0019.

## Manager-initiated add
A Player record created by the Event Owner or an Admin acting on behalf of someone else — typically a guest with no Convocados account, or a registered user the organizer is adding. Distinct from a self-initiated add (Quick Join, Claim), where the player themselves triggered the action.

Domain consequences of the distinction:
- **Confirmation**: manager-initiated adds surface a confirmation dialog in the web and Android apps; self-initiated adds do not. The misclick surface lives almost entirely in the manager path.
- **Auto-follow**: a manager-initiated add does **not** create an `EventFollow` on the added user's behalf; a self-initiated add does.
- **Payment enforcement**: manager-initiated adds always bypass the outstanding balance gate; self-initiated adds respect it.

## Payment enforcement level
A per-Game setting controlling how the Outstanding Balance is surfaced at join time. Stored on `Event`. Levels:
- **off** — balance not surfaced at join; current behaviour.
- **nudge** (default) — a dismissible interstitial + debt-aware join button when the joining Player has a balance > 0. Never blocks.
- **soft_gate** — joining while owing requires explicitly choosing "join and pay later," which notifies the Owner. Does not block.
- **hard_gate** — a self-service joiner whose **pending** balance exceeds the gate threshold is fully blocked from joining (no bench-waiting, to avoid the auto-promotion leak). Cleared by reaching `paid` **or** `sent` on the outstanding amount (so an offline Owner cannot strand a player).

Enforcement only applies to **attributable self-service joins** (Quick Join / Claim). Owner/Admin adding any Player — including unlinked guests — always bypasses enforcement. The gate threshold is a per-Game amount in the Game's currency (default `0` = any unpaid debt triggers it).

## Debt visibility
How Outstanding Balances are exposed:
- The **owing Player** always sees their own balance prominently (drives the nudge).
- **Other players** see only an aggregate social-proof signal (e.g. "9 of 11 paid for the last game") — never individual names.
- The **Owner/Admin** always sees the full per-Player breakdown.

A per-Game `showDebtorNames` toggle (default **off**) lets the Owner reveal individual debtor names to the whole group for clubs that want full transparency. Default is privacy-preserving to keep casual groups friendly.

## Monthly Subscription
A Player's standing relationship with an Event for one calendar month, granting the right to attend non-cancelled Event instances in that month without per-game payment, in exchange for a fixed monthly fee paid outside the app. The organizer marks the subscription `active` in Convocados once the money is received.
_Avoid_: membership, plan, subscription

A Monthly Subscription is **per-Event** — a player can be Monthly on Event A and Per-game on Event B at the same time.

## Per-game Player
A player paying the existing per-game share on each Event instance. The default model.

**Per-player amount** = `EventCost.totalAmount / count(players on the payment list)`. The payment list is the set of `PlayerPayment` rows for the current Game. Before the payment list exists (pre-game, cost set but no players yet added), the UI shows a **price preview** of `totalAmount / maxPlayers` so players know what to budget. Once the game is over and the payment list is final, the actual per-player amount may differ from the preview if fewer than `maxPlayers` attended.

Who is on the payment list is entirely at the Organizer's discretion — there is no automatic exclusion of no-shows. The Organizer controls the list before distributing it.
_Avoid_: pay-as-you-go player, casual player

## Wallet
A per-(User, Event) running balance of **Game Units** — currency-agnostic "missed games." A Monthly subscriber earns 1 Game Unit per missed non-cancelled Event instance; redeemed automatically (1 unit = 1 free per-game share) on the player's next join. Game Units expire at the end of the calendar month following the month they were earned (in the Event's timezone).
_Avoid_: credits, balance, tab (tab remains the *currency* balance for Per-game Players)

## Drop-in Surcharge
A configurable per-Event amount added to the `PlayerPayment` of a Per-game Player who is not a Monthly subscriber for the Event in the current month. Incentivises monthly sign-up.
_Avoid_: penalty, casual surcharge

## Subscription Window
The calendar month (in the Event's timezone) a Monthly Subscription is valid for. A subscription for "2026-06" covers any Event instance whose `dateTime` is in June 2026. Outside the window, the player falls back to Per-game.
_Avoid_: billing period, cycle

## Game Unit
The abstract denomination of Wallet credit. 1 unit = 1 missed non-cancelled Event instance. The € value displayed next to a Game Unit is informational, **locked at the per-game share in effect on the day of the miss** (snapshot, not recompute).
_Avoid_: credit, token

## Transaction
An immutable row in the per-Event ledger recording a money or Game-Unit movement on behalf of a player. `amountCents` (in Event currency), `direction` (`debit` | `credit`), `reason` (enum: `per_game_share`, `monthly_fee`, `missed_game_credit`, `credit_redeemed`, `credit_expired`, `extras_declare`, `payment_received`, `payment_self_reported`), references to the source (`eventInstanceId`, `subscriptionId`, `extrasId`). The ledger is the single source of truth for balances, the join gate, and per-player history. `PlayerPayment.status` becomes a *projection* of the ledger.
_Avoid_: payment, ledger entry, journal line

## Extras Pot
The per-Event running balance of *forfeited* credit and declared spends, in Event currency. Credited by `credit_expired` transactions; debited by `extras_declare` transactions the organizer enters. Visible to all members of the Event. The pot is an honest ledger, not a money account — the app never touches real funds.
_Avoid_: surplus, organizer wallet, kitty

## Invite
A request to participate in a **Game**, sent to a person on behalf of the inviting **User** when a **Player** is being added by an Owner/Admin. Carried as a push notification (to a registered **User** whose email matches) or an email (to an unregistered address, asking them to register). Triggered automatically by the add-player action whenever the email resolves to a non-self **User** or is provided without resolving. Single-shot: not stored, not retried, not visible to the recipient before they accept. On the web/Android client, an Owner/Admin can also pick a contact from the device address book to populate the player's name and email in one step.
_Avoid_: notify, ask to join, request access

## EventInvite
An entry in the per-**Game** access-bypass list. Grants the linked **User** access to a password-protected **Game** without supplying the event password. Distinct from `Invite` — this is about *access* to a private game, not *participation* in any game.
_Avoid_: guest pass, share code

## Attendance
A participant's response to an upcoming **Game** — yes / no / pending — captured before kickoff so the organizer can plan teams and benches. Scoped to a specific Game (not the Event series).

The user-facing term is **Attendance**; the data model is the `Rsvp` table keyed on `gameId`. Each row is keyed on exactly one subject:
- **`userId`** — the signed-in User's own response.
- **`eventPlayerId`** — an admin/owner setting attendance on behalf of an anonymous EventPlayer.

### RSVP recipients
Only **GameParticipants** with a linked authenticated User receive the attendance prompt. Followers who aren't playing do not.

### Timing
- **T-48h (Players)**: RSVP request sent to authenticated GameParticipants
- **T-48h (non-playing Followers)**: Recruitment ping when game not full ("Game still needs N players — join now!")
- **T-24h**: summary sent to Owner + Admins if any responses are missing
- **Joining a Game = implicit "yes"**: no RSVP ping to someone who just added themselves

### What does NOT trigger notifications
- RSVP answers from players do NOT broadcast to followers or other players (that is spam)
- Player join/leave does NOT notify non-playing Followers (only Players + opted-in Followers)

Distinguished from the historical-stats API at `/api/events/[id]/attendance` (which computes per-player attendance rate from Game records).
_Avoid_: RSVP (table name only), response

### Leave / Re-join round-trip
An **EventPlayer** can leave a Game via the X button (admin) or the "Not coming" CTA (self). The leave is a **soft-archive**: `GameParticipant.archivedAt` is set, the row is hidden from the active list, and an `Rsvp` with `status="no"` is recorded for that Game.

Re-adding the same person (self or by an organizer) is a **silent un-archive**: the GameParticipant is placed at the **end of the list** (queue/join semantics), `archivedAt` is cleared, and the RSVP is reset to `status="yes"`.

## App Deep Link
A `convocados://` URL handled by the Android app's manifest intent-filter. Paths under the scheme (e.g. `convocados://events/<id>`, `convocados://auth?code=...`) launch the app and arrive as `Intent.data` on `MainActivity`. The intent can be inspected at cold start (`onCreate`) or on resume (`onNewIntent`). Two distinct consumers:
- **Navigation deep link** (`convocados://events/<id>`, `convocados://games`, `convocados://create`) — must be resolved to a Compose `Route` and navigated to. Preserved across login so a user who taps a link while logged out lands on the destination after authenticating.
- **OAuth callback** (`convocados://auth?code=...`) — handled by `RootViewModel.handleIntent`, exchanged for tokens via `ApiClient.exchangeCode`. Distinct from navigation: never fed to the navigation router.

The Android app extracts only the **extras** (`intent.getStringExtra("deep_link" | "navigate_to")`) but **not** `intent.data`, so scheme-URL deep links silently never reach the navigation layer. See ADR-0012.
_Avoid_: deeplink (one word), intent URL, app link

## Auth Callback URL
The URL the user lands on after a successful sign-in. Three transport paths, all converging on the same shape — a **relative path** on the app's own origin (validated against the open-redirect pattern `//evil`):
1. **Email/password or magic-link** (`web`) — read from `?callbackURL=` on the signin page, used by `SignInPage.handlePasswordSubmit` and the already-authenticated `useEffect` redirect.
2. **Google OAuth** (`web`) — passed to `signIn.social({callbackURL})`, written into the `better-auth.state` cookie, and read back server-side on the `/api/auth/callback/google` handler to issue the final 302. The state is the single source of truth for the destination.
3. **Mobile OAuth** (`android`) — there is no per-flow callback URL: `AuthManager.startLogin` hardcodes `convocados://auth`. Navigation to a deep-linked screen is a separate concern (see App Deep Link).

Sanitization: the web `SignInPage` rejects `//` prefixed values to block open redirects. The default fallback (when no callbackURL is present) is `/dashboard` on web, `Route.Games.route` on Android.
_Avoid_: postLoginURL (component-internal only), returnUrl, redirect_to

## OAuth State
A better-auth-managed, short-lived, HttpOnly cookie (`better-auth.state`) that carries authentication-flow context across the OAuth round-trip. On `POST /api/auth/sign-in/social` the server stores the requested `callbackURL` in the state, then redirects the browser to the provider with a `state` query param. On the provider callback (`/api/auth/callback/<provider>?state=...&code=...`) the server reads the state cookie, extracts the callbackURL, and 302-redirects the browser there. The cookie is single-use (consumed on read) and expires in 5 minutes — long enough to survive a Google sign-in, short enough that a leaked state cannot be replayed. State is the **only** carrier of the post-auth destination for social sign-in; losing it means the user lands on the default landing page.
_Avoid_: nonce (overloaded with CSRF), request_token, oauth_token

