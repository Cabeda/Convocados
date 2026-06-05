# Auto-Link Player to User Account on Name Match

> Reference for the auto-link behavior introduced in #374. Walks through the resolution flow, enumerates every case, and documents the open edge cases (tracked in #373).

## Problem

Recurring events use a **lazy reset**: on every `GET /api/events/[id]` past `nextResetAt`, the server runs `prisma.player.deleteMany({ where: { eventId } })` and wipes the roster. The next add re-creates the players from scratch.

Two flows can re-add a player:

1. **Quick Join** — the player taps "Join" themselves. The client sends `{ name, linkToAccount: true }`, and the route sets `Player.userId = session.user.id`.
2. **Owner-types-on-behalf** — the event owner (or anyone with `manage:players` scope) types a name into the add-player field. The client sends `{ name }` with no `linkToAccount` flag. The route used to create an **anonymous** `Player` row even if the typed name matched a registered user.

The second flow produced "anonymous twins" on every reset. In the reported case, user **Gonçalo Silva** (`User.id = bJzXFpoS7oxI3kpkKsgIR6tdvVfs4b2t`) had his `Player` row wiped by the reset and replaced by a fresh anonymous `Player` with the same name. He then saw an empty **My Games** page until he manually claimed the record.

## Goal

Eliminate anonymous twins caused by the owner-types-on-behalf flow, without changing Quick Join semantics and without surprising the owner with an explicit account link they didn't ask for.

## Resolution flow

The `POST /api/events/[id]/players` route resolves `linkedUserId` once, before the insert:

```
┌──────────────────────────────────────────────────────────────┐
│  Input: { name: string, linkToAccount?: boolean, ... }      │
│        session: Session | null                              │
│        eventId: string                                      │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │  Is linkToAccount === true          │
        │  AND session?.user is set?          │
        └─────────────────────────────────────┘
                  │ yes               │ no
                  ▼                   ▼
   ┌──────────────────────────┐  ┌──────────────────────────────────┐
   │ linkedUserId =           │  │ Normalize name and look up users  │
   │   session.user.id        │  │ with the same normalized name.    │
   │ (Quick Join — unchanged) │  │                                   │
   └──────────────────────────┘  │ matches = users where             │
                                 │   normalizeForMatch(name)         │
                                 │   === normalizeForMatch(input)   │
                                 └──────────────────────────────────┘
                          │                       │
                          ▼                       ▼
                  ┌───────────────────────────────────────┐
                  │  matches.length === 1                 │
                  │  AND name is non-empty                │
                  │  AND that user has NO existing        │
                  │  Player in this event?                │
                  └───────────────────────────────────────┘
                  │ yes               │ no
                  ▼                   ▼
   ┌──────────────────────────┐  ┌──────────────────────────────┐
   │ linkedUserId =           │  │ linkedUserId = null          │
   │   matches[0].id          │  │ (stay anonymous)             │
   │ (auto-link fires)        │  │                              │
   └──────────────────────────┘  └──────────────────────────────┘
                          │
                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Insert Player with the resolved linkedUserId.               │
   │  If the name already exists in the event -> 409 P2002.       │
   │  Send a personalized invite email only if linkedUserId !=    │
   │  null AND the user has a verified email.                      │
   └──────────────────────────────────────────────────────────────┘
```

The resolved `linkedUserId` flows into:

- The `Player` row (the link itself)
- The email-notify block (whether to send a personalized invite vs. an anonymous one)
- The autocomplete/quick-add `ShieldIcon` rendering (UI cue)

## Case matrix

`name` is the trimmed input. "Matches" means `normalizeForMatch(name) === normalizeForMatch(user.name)`. "In event" means `Player` row exists with the same `eventId` and the candidate `userId`.

| # | Scenario | `linkToAccount` | Session | Outcome | `linkedUserId` | Email sent? |
|---|----------|-----------------|---------|---------|----------------|-------------|
| 1 | Quick Join (self) | `true` | user X | Link to X | `X.id` | Yes (if email verified) |
| 2 | Quick Join without session | `true` | anonymous | Falls through to auto-link | (see auto-link) | (see auto-link) |
| 3 | Owner adds X by name, name matches X only | absent / `false` | anyone | Auto-link to X | `X.id` | Yes (X) |
| 4 | Owner adds X by name, X already has a player in the event | absent / `false` | anyone | Stay anonymous | `null` | No |
| 5 | Owner adds "Gonçalo", only one user named "Gonçalo" | absent / `false` | anyone | Auto-link | `user.id` | Yes |
| 6 | Owner adds "goncalo" (case differs), one user named "Gonçalo" | absent / `false` | anyone | Auto-link (case-insensitive) | `user.id` | Yes |
| 7 | Owner adds "Gonça1o" (typo), no match | absent / `false` | anyone | Stay anonymous | `null` | No |
| 8 | Owner adds "Pedro", two users named "Pedro" | absent / `false` | anyone | Stay anonymous (ambiguous) | `null` | No |
| 9 | Owner adds "Gonçalo Silva" (full name), user is named "Gonçalo" | absent / `false` | anyone | Stay anonymous (no exact match) | `null` | No |
| 10 | Owner adds empty / whitespace-only name | any | anyone | 400 (validation) | n/a | No |
| 11 | Owner adds "Gonçalo", name exists as anonymous player in the event | absent / `false` | anyone | 409 P2002 (name conflict) | n/a | No |
| 12 | Two concurrent adds of "Gonçalo" by the same user | absent / `false` | anyone | One row created, the other gets 409 P2002 (name) — **but** a different user could create a *second* `Player` row with their own `userId` (see [TOCTOU](#toctou-on-duplicate-link-guard)) | n/a | n/a |

## Normalization rules

`normalizeForMatch` (in `src/lib/stringMatch.ts`):

```ts
function normalizeForMatch(s: string): string {
  return s.normalize("NFD")
           .replace(/[\u0300-\u036f]/g, "")
           .toLowerCase();
}
```

This is the source of truth for accent + case folding. **Both** the typed `name` and each `user.name` are normalized before comparison.

Not currently handled (deferred to #373):

- Zero-width characters (`U+200B`, `U+200C`, `U+200D`, `U+FEFF`)
- Non-breaking space (`U+00A0`)
- Multiple internal whitespace

## UI signal

The `known-players` API enriches suggestions with `userId`. The autocomplete and quick-add chips render a `<ShieldIcon>` with a `protectedPlayer` tooltip on any suggestion whose `userId` is set, so the owner can see at a glance which names would auto-link.

> The tooltip reuses the existing `protectedPlayer` key, which means "only the owner can remove this player record". The new behavior stretches that copy slightly — it also implies "this name resolves to a real account". A dedicated `linkedToAccount` i18n key is tracked in #373.

Anonymous suggestions show no shield.

## Edge cases (tracked in #373)

### TOCTOU on duplicate-link guard

The "X is not already in the event" check is `prisma.player.count` followed by `prisma.player.create`. Two concurrent adds of the same name can both observe `count === 0` and both insert. The `(eventId, name)` unique constraint catches the name duplicate (P2002), but the `(eventId, userId)` constraint does not exist — so two `Player` rows with the *same* `userId` can be created in the same event.

Fix: add `@@unique([eventId, userId])` to the `Player` model and handle P2002 in the route. Add a `Promise.all` test that asserts only one row is created.

### Full-table `findMany` per add

`prisma.user.findMany({ select: { id, name } })` loads the whole `User` table on every add and filters in JS. Fine at ~100 users, problematic at ~10k with write traffic.

Fix: add a `nameNormalized` column to `User` with a functional index, populated on create/update + backfill migration. Replace the JS filter with `WHERE nameNormalized = ?`.

### Ambiguous match is silent

Two users named "Pedro" → no auto-link, no error, no signal. The owner thinks they added "Pedro" but Pedro #1 and Pedro #2 see different rosters.

Fix: return a `linkStatus: "linked" | "ambiguous" | "no-match" | "already-in-event"` field in the response, surface a snackbar in `PlayerList` on `ambiguous` or `already-in-event`.

### Resolver is inline

The resolution logic is embedded in the route handler. Extracting to `src/lib/playerLink.server.ts` with a `resolveLinkedUserId({ name, session, eventId })` function makes it unit-testable in milliseconds and keeps the route thin.

## Manual recovery for orphaned records

The fix is **forward-looking** — it auto-links on the *next* add. Existing orphaned `Player` rows with `userId: null` are not touched.

To recover an orphan, the affected user has two options:

1. **Claim** from the **Rankings** page. The `POST /api/events/[id]/claim-player` flow renames the anonymous player and links the `userId`.
2. **Owner removes the orphan** and the next re-add auto-links correctly (assuming the owner types the right name).

For the more complex case where both anonymous and logged-in records exist (same human, two `PlayerRating` entries), use the admin **merge-player** flow (`POST /api/events/[id]/merge-player`) documented in #297.

## Related

- #374 — implementation PR
- #373 — hardening follow-up
- #297 — full claim-player / merge-player spec (handles the pre-existing case where both anonymous and logged-in records exist)