# 0011 — Add-player confirmation dialog (manager-initiated only)

**Status:** Accepted
**Date:** 2026-06-16

## Context

The web and Android apps expose several "add a player" affordances on the
event detail page. The most accidental of them — recent-players
`AssistChip` taps, autocomplete dropdown row selects, and the multi-line
paste handler — are single-tap actions that create a `Player` record (with
notifications, an `EventLog` row, possibly an email invite) on click. There
is no confirmation; a misclick adds the wrong person, fires a
`player_joined` notification, and the organizer has to remove + undo.

`#455` (Add confirmation message to add player) asks for a confirmation
gate. The issue author also flagged that the pills ("chips") would benefit
from phone-friendly tap targets, but that's a secondary concern addressed
by the trigger surface (Q3) below.

The codebase already has a hybrid precedent: `RankingsPage.tsx:516-529`
shows a `Dialog` for "Claim as me" (a manager-initiated action) but
`QuickJoin.tsx` does not show a dialog for self-join. The existing
`EventDialogs.tsx` re-randomize and relinquish-ownership dialogs are
manager-initiated. The pattern is consistent: dialogs exist for
manager-initiated actions, not for self-initiated ones.

## Decision

Add a confirmation dialog for **manager-initiated adds only**, on the
single-tap affordances (chip tap, dropdown row select), in the web and
Android apps.

**Trigger surface** (Q3, Q4):
- *Shows dialog*: web recent-players `Chip` tap; web autocomplete
  `Autocomplete` dropdown option select; Android `AssistChip` quick-add
  suggestions; Android autocomplete dropdown `clickable` row.
- *No dialog*: typing a name + pressing Enter; typing a name + tapping the
  `+` `IconButton`; Quick Join (self-initiated); Android contact picker
  (the system picker is its own confirmation surface); the bulk-paste
  handler is removed entirely (see "Dropped" below).
- *Rationale*: typing a name is itself a deliberate action; the single-tap
  paths are the misclick surface. The asymmetry between "type + Enter" and
  "click chip" matches the existing pattern in `PlayerList.tsx` and the
  user's stated intent in `#455` ("misclick and adding a player").

**Dropped**: the multi-line paste handler in `PlayerList.tsx:177-184` is
deleted. The autocomplete `TextField` is single-line; the multi-line
branch was a hack. Players join via Quick Join (self-initiated) or are
added one at a time by the manager (with the dialog). The "bulk endpoint"
(`/api/events/[id]/players/bulk`) considered during planning is not built.

**Dialog content** (Q6):
- *Title*: `Add {name}?` (web) / `Add {name}?` (Android, M3 stack).
- *Body*: web — `This adds {name} to the player list for {eventName}.` with
  optional sentences appended for the email-invite and bench (roster full)
  cases. Android — `Add {name} to {eventName}?` with optional clauses
  appended; shorter form factor for a phone dialog.
- *Confirm*: `Add player` (web) / `Add` (Android, reuses `add_button`).
- *Cancel*: `Cancel` (both, reuses existing `cancel` key).
- *No opt-out*: no "Don't ask again this session" checkbox. The issue says
  "every time." A bypass can be added later if organizers complain.

**In-flight guard** (Q8, Q16):
- The dialog's confirm `Button` is `disabled` while the request is in
  flight. A second tap on the button is absorbed.
- The `addPlayer` callback in `EventPage` holds a `useRef<boolean>` for
  the in-flight flag. If a second `addPlayer` call arrives while the first
  is in flight, it returns early. The caller surfaces a snackbar:
  `Adding {name} — please wait`.

**Idempotency** (Q9, ADR 0010): the request carries an `Idempotency-Key`
header (client-generated UUIDv4). The server's idempotency middleware
replays the cached response on a network retry. The Android client sends
the same header.

**Lifted state** (Q11): the dialog is owned by `EventPage`, not by the
per-component `PlayerList` / `PlayerAutocomplete`. These components
dispatch an `AddPlayerIntent` (`{ kind: "single", name, email?, source }`)
via a new `onRequestAdd` prop. `EventPage` opens the dialog, computes the
bench/email footnotes from the event state, and on confirm calls the
existing `addPlayer` (extended with the in-flight guard and the
`Idempotency-Key` header). One dialog, one place for the content rules,
one place for the success snackbar.

**i18n** (Q18): seven new keys per platform, in all six locales each.
Web uses the camelCase `addPlayerConfirm*` keys added to
`src/lib/i18n/{en,pt,es,fr,de,it}.ts`. Android uses snake_case
`add_player_confirm_*` in `android-app/app/src/main/res/values{,-pt,-es,-fr,-de,-it}/strings.xml`.
The existing `src/test/i18n.test.ts:38-66` enforces web parity
automatically. A new `android-app/app/src/test/.../stringsParityTest.kt`
enforces Android parity.

**Tests** (Q10):
- Vitest component tests: `PlayerList.test.tsx` (new) covers chip
  confirmation, Enter no-dialog, IconButton no-dialog, modal cancel,
  modal confirm + addPlayer call, disabled-while-in-flight, modal body
  with email set, modal body with bench state.
- Vitest component tests: `PlayerAutocomplete.test.tsx` (new) covers
  dropdown select → dialog, Enter / IconButton no-dialog.
- Vitest component tests: `QuickJoin.test.tsx` (new) covers
  self-join has no dialog.
- Vitest integration: covered by `idempotency.test.ts` (ADR 0010).
- JUnit: `EventDetailViewModelTest.kt` asserts `Idempotency-Key` header
  on the outgoing request.
- E2E (Playwright) and Compose UI tests are *not* in v1; filed as
  follow-ups.

### Alternatives considered

- **Dialog on every add, including self-join** — consistent, but Quick
  Join is a self-initiated action where the user typed their own name and
  tapped a single "Join" button. The misclick risk is low; the friction
  cost is high. Reject.
- **Undo snackbar after add (no dialog)** — matches the existing Remove
  undo pattern, no extra click on the happy path, but the misclick has
  already happened. The user would need to notice the wrong player on
  the roster, which is harder than confirming up front. Reject.
- **Modal on every add (chip, dropdown, Enter, IconButton, paste)** —
  most defensive, but pastes of N names would open N modals. The paste
  path is removed in this design, but the typing-Enter path is also
  modal in this alternative. Reject: typing is itself a deliberate
  action; the asymmetry between "type + Enter" and "click chip" is
  defensible.
- **Long-press to confirm on mobile** — common Android pattern, but
  would require a gesture detector on the chip and would be invisible
  to most users. The platform's standard `AlertDialog` is more
  discoverable. Reject.

## Consequences

- The web bundle gains one new component (`AddPlayerConfirmDialog`) and
  one new i18n key group (7 keys × 6 locales).
- The Android app gains a new `AlertDialog` branch in
  `EventDetailScreen.kt` and the same 7 keys × 6 locales.
- The `Idempotency-Key` header is now a contract — any future write
  endpoint that needs idempotency can opt in via
  `withIdempotency(ctx, handler)`.
- The multi-line paste handler is gone. Power users who relied on
  copy-pasting 10 names from a spreadsheet will need to either add
  themselves via Quick Join (one at a time) or be added by the organizer
  one at a time. The dialog is now part of the latter flow.
- The asymmetry between manager-initiated and self-initiated is
  documented in `CONTEXT.md` (new `Manager-initiated add` glossary
  entry) and reinforced by the dialog's existence.
- No data model changes. The audit field `Player.invitedByUserId`
  continues to capture who added whom; the new behavior is purely
  client + middleware.
- The dialog can be tuned later (e.g. allow a "Don't ask again" toggle
  per event or per session) without changing the contract — only the
  condition that decides whether to open the dialog changes.
