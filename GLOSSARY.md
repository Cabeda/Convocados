# Convocados

Football game coordination: recurring games, rosters, RSVPs, payments, rankings.

## Language

### Core

**Event**:
The recurring game series — one row that occurrences advance through in place.
_Avoid_: Game (for the series), fixture, tournament

**Game**:
A single occurrence of an Event (`currentGameId` while live; history keeps past ones).
_Avoid_: Occurrence, match (match = one played Game's scoreline), session

**Roster**:
The ordered list of players on an Event's current Game — active spots first, bench past `maxPlayers`.
_Avoid_: List, squad, players table

### Notifications

**Reminder Timings**:
The organizer's per-event selection of which pre-game reminders exist (`24h`/`2h`/`1h`). Gates every channel at emission.
_Avoid_: Reminder preferences (that's the user-level `NotificationPreferences`), muteReminders (retired)

**Webhook Event**:
An immutable domain fact delivered to a subscription as lean parameters — no rendered copy, no pacing hints. Clients render.
_Avoid_: Message, notification payload (those imply copy), alert

**Importance dial**:
The `events` list on a Webhook Subscription — the owner's declaration of which facts that subscription hears. Empty = all.
_Avoid_: Filter (this is a selection of interest, not a suppression of noise)

**Nudge Escalation**:
The payment chase lifecycle: three debtor nudges of increasing social pressure, then an organizer alert.
_Avoid_: Payment reminders (too vague — also the user-pref channel flags), dunning
