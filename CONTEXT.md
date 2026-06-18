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
2. It is the **gating condition** for receiving notifications from that Game — only followers receive push notifications (web + mobile), subject to per-event overrides.

Each `EventFollow` carries nullable per-type override columns (`mutePlayerActivity`, `muteReminders`, `mutePostGame`, `muteEventDetails`). Tri-state semantics:
- `null` — use the user's global preference from `NotificationPreferences`
- `true` — suppress this notification type for this game regardless of global setting
- `false` — force-enable this type for this game regardless of global setting

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

Resolution order for each notification type:
1. Per-event override on `EventFollow` (if not null, wins)
2. Global user preference from `NotificationPreferences`
3. System default (all push enabled)

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

## Court Alternative
A Playtomic court slot that matches an existing Game's dateTime (±30 min), sport, and minimum duration, offered as a replacement option. Surfaced to Owner/Admins only — either via manual search or an automated hourly background sweep ("Court Watch"). Filtered by distance from the Game's coordinates, and optionally by indoor/outdoor and surface type (best-effort, dependent on Playtomic data availability). When accepted ("Switch"), the Game's location and coordinates are updated and all Followers are notified via the standard event-details-changed flow.

## Court Watch
An opt-in background process that checks Playtomic hourly for Court Alternatives matching a Game's criteria. Enabled per-game by an Admin via a JSON config (`courtWatchConfig`) on the Event. Requires the Event to have latitude/longitude. Alerts are deduplicated — the same slot is never re-notified. Watching stops only when the Admin disables it.

## Outstanding Balance ("tab")
The total amount a Player still owes within a single Game, computed (not stored) by summing unpaid amounts across that Game's played history (`GameHistory.paymentsSnapshot`) plus the current unpaid `PlayerPayment` rows. Scoped **per-Game, keyed by `playerName`** — it does not span events, and a name in one Game is unrelated to the same name in another. "Tab" is the informal synonym.

A balance is only attributable to a person (and therefore eligible to drive a personal payment nudge) when the Player is linked to a `User` who is acting on their own behalf (Quick Join / Claim). For owner-added guests with no account, the balance is informational only — surfaced to the Owner/Admin, never as a personal nudge.

## Payment status lifecycle
A `PlayerPayment` (and each entry in a `GameHistory.paymentsSnapshot`) moves through:
- **pending** — owed, no action taken. Counts toward the Outstanding Balance.
- **sent** — the Player has self-reported paying (e.g. tapped "Pay & join" and confirmed they sent the transfer). Still counts toward the balance — the debt is not cleared until confirmed. Only the Player acting on their own behalf may move `pending → sent`.
- **paid** — the Owner/Admin has confirmed receipt. The only status that clears the balance. Only Owner/Admin may set `paid` (and may move `sent → paid` or `pending → paid` directly).

The Owner/Admin remains the single source of truth for money actually received; `sent` is a courtesy signal that gives the payer closure and gives the organizer a "confirm received" worklist. It never auto-promotes to `paid`.

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
A player paying the existing per-game share (`eventCost.totalAmount / maxPlayers`) on each Event instance. The default model.
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
A User's response to an upcoming **Game** — yes / no / pending — captured before kickoff so the organizer can plan teams, refs, and benches. Distinct from **attendance rate** (a historical statistic computed from `GameHistory`).

The user-facing term is **Attendance**; the data model is the `Rsvp` table. Each row is keyed on exactly one subject:
- **`userId`** — the signed-in User's own response (self-RSVP via `POST /api/events/[id]/rsvp`).
- **`playerId`** — an admin/owner setting attendance on behalf of a **Player** with no linked account (a guest), via `POST /api/events/[id]/players/[playerId]/rsvp`. The admin's `userId` is recorded in `respondedByUserId` for audit.

Application invariant (not enforced by the schema because SQLite unique constraints treat NULL as distinct): exactly one of `{userId, playerId}` is set per row. `upsertGuestRsvp` rejects linked players (where `Player.userId` is set) — those users self-RSVP.

The recipient set for a Game is the union of: **EventFollow** (followers), `Player.userId` (linked players), and the **Owner**. The summary counts `yes`/`no`/`pending` across both the user recipient set and active guest players (`Player.userId IS NULL AND archivedAt IS NULL`).

Distinguished from the historical-stats API at `/api/events/[id]/attendance` (which computes per-player attendance rate from `GameHistory`); that endpoint shares the user-facing word but is a different concept.
_Avoid_: RSVP (table name only), response
