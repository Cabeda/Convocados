# ADR 0016 — Occurrence-Based Recurrence Model

## Status

Accepted

## Context

The current recurring event model reuses a single `Event` row across all occurrences. On each recurrence "reset", a destructive transaction deletes all Player, TeamResult, Rsvp, and PlayerPayment rows, serialises a partial snapshot into `GameHistory.teamsSnapshot` (JSON), and advances `dateTime`.

Problems: data loss on reset, stale RSVP bugs, unqueryable JSON history, no undo, ambiguous identity for external references. See full problem analysis in the earlier design discussion.

## Decision

Introduce a **Game** entity (one per occurrence) and an **EventPlayer** entity (series-level participant identity). The Event becomes a series template; the Game holds per-occurrence state; the EventPlayer persists across Games.

## Terminology

- **Event** = the recurring series / template (config, rules, settings)
- **Game** = a single occurrence (one date, one roster, one score)
- **EventPlayer** = persistent participant identity within an Event series
- **GameParticipant** = a link between an EventPlayer and a specific Game

## Schema

### Game

```prisma
model Game {
  id              String    @id @default(cuid())
  eventId         String
  event           Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  dateTime        DateTime
  status          String    @default("upcoming") // "upcoming" | "in_progress" | "played" | "cancelled"
  isFriendly      Boolean   @default(false) // friendly games excluded from ELO
  scoreOne        Int?
  scoreTwo        Int?
  teamOneName     String?   // inherits from Event if null
  teamTwoName     String?
  eloProcessed    Boolean   @default(false)
  rsvpCutoffSent  Boolean   @default(false)

  participants    GameParticipant[]
  teamResults     TeamResult[]
  rsvps           Rsvp[]
  payments        GamePayment[]
  mvpVotes        MvpVote[]
  priorityConfirmations PriorityConfirmation[]
  reminderLogs    ReminderLog[]

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([eventId, dateTime])
  @@index([eventId, status])
}
```

### EventPlayer

Absorbs the current `PlayerRating` model. One per person per Event.

```prisma
model EventPlayer {
  id            String   @id @default(cuid())
  eventId       String
  event         Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  name          String
  userId        String?  // null = anonymous player
  user          User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  rating        Float    @default(1000)
  gamesPlayed   Int      @default(0)
  wins          Int      @default(0)
  draws         Int      @default(0)
  losses        Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  participations GameParticipant[]
  payments       GamePayment[]

  @@unique([eventId, name])
  @@index([userId])
}
```

### GameParticipant

Per-game participation link.

```prisma
model GameParticipant {
  id            String      @id @default(cuid())
  gameId        String
  game          Game        @relation(fields: [gameId], references: [id], onDelete: Cascade)
  eventPlayerId String
  eventPlayer   EventPlayer @relation(fields: [eventPlayerId], references: [id], onDelete: Cascade)
  order         Int         @default(0)
  archivedAt    DateTime?   // soft-archive = "left this game"
  createdAt     DateTime    @default(now())

  @@unique([gameId, eventPlayerId])
  @@index([eventPlayerId])
}
```

### GamePayment

Per-game payment record.

```prisma
model GamePayment {
  id            String      @id @default(cuid())
  gameId        String
  game          Game        @relation(fields: [gameId], references: [id], onDelete: Cascade)
  eventPlayerId String
  eventPlayer   EventPlayer @relation(fields: [eventPlayerId], references: [id], onDelete: Cascade)
  playerName    String      // denormalized at write time
  amount        Float
  status        String      @default("pending") // "pending" | "sent" | "paid"
  method        String?
  paidAt        DateTime?
  markedBy      String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([gameId, eventPlayerId])
}
```

### Event changes

```prisma
model Event {
  // ... existing fields ...
  currentGameId   String?   // FK to the active Game (null if archived/no games yet)
  // REMOVED: nextResetAt, rsvpCutoffSent (moved to Game)
  // KEPT: all settings, recurrenceRule, priority config, EventCost (template)
}
```

## Key Design Decisions

### 1. Uniform model — every Event has a Game
Non-recurring Events get exactly one Game. No conditional code paths.

### 2. Explicit `currentGameId` pointer
Updated via CAS on advancement. O(1) reads for the hot path.

### 3. Lifecycle transitions are lazy (on GET) + scheduled notifications
Status transitions: `upcoming → in_progress → played` triggered on first GET after time passes. Reminder notifications use the existing ScheduledJob system.

### 4. `isFriendly` — settable any time by owner/admin
Before, during, or after the Game. Toggling triggers ELO reprocessing for the Event.

### 5. EventPlayer claim flow
User-initiated, explicit. Blocked if any Game overlap exists between the anonymous identity and the authenticated user's identity. Organizer resolves duplicates first.

### 6. Join flow
Tap "Entrar neste jogo" → find EventPlayer by userId (or create one with User.name) → create GameParticipant. No auto-link to anonymous players.

### 7. RSVP scoped to Game, recipients = GameParticipants only
- T-48h: ping authenticated GameParticipants for attendance confirmation
- T-24h: owner/admin summary if missing answers
- Joining a Game = implicit "yes" (no RSVP ping to joiners)
- RSVP answers do NOT broadcast to followers

### 8. New Game starts empty
Priority auto-enrollment + manual adds. Carry-over modes are a future feature (issue #521).

### 9. Notification matrix (reduced)

| Trigger | Recipients |
|---------|-----------|
| RSVP request | GameParticipants (authenticated) |
| RSVP summary (missing) | Owner + Admins |
| Player joined/left | Owner + Admins |
| Game reminder (2h) | GameParticipants who said "yes" or no answer |
| Post-game results | GameParticipants + opt-in Followers |
| Event details changed | All Followers + current GameParticipants |
| New Game created | Followers |

### 10. API — backwards-compatible, additive
- `/events/:eventId` resolves to current Game (adds `gameId` field to response)
- `/api/events/:eventId/games/:gameId` for programmatic access to past Games
- Frontend stays at `/events/:eventId`, history shown inline
- Android app: compare `gameId` instead of `wasReset` flag

### 11. EventPlayer.name is mutable
Owner/admin can rename. Historical denormalized fields (GamePayment.playerName, MvpVote names) keep the name at time of write. Independent from User.name.

### 12. Cross-event stats computed on read
No new table. Query GameParticipants across Events by userId. Sufficient for current scale.

## Migration Strategy

### Phase 1 — Schema + dual-write (non-breaking)
1. Add Game, EventPlayer, GameParticipant, GamePayment models
2. Add `currentGameId` to Event
3. Backfill: for each Event, create EventPlayer from existing PlayerRating + Player rows
4. Backfill: for each GameHistory with teamsSnapshot, create Game + GameParticipants (best-effort)
5. For GameHistory with null teamsSnapshot: keep as-is (read-only fallback)
6. Create a Game for the current occurrence of each Event (from live Player rows)
7. Dual-write: advancement creates new Game AND still does old delete path

### Phase 2 — Read from new model
1. Event GET reads from currentGame.participants
2. Player/RSVP/team CRUD routes via currentGameId
3. History endpoint reads Game rows, falls back to GameHistory for old entries
4. known-players queries EventPlayer table (no JSON parsing)
5. ELO processor works on Game rows

### Phase 3 — Cleanup
1. Remove destructive deleteMany path
2. Remove Player model (replaced by GameParticipant)
3. Remove PlayerRating model (absorbed into EventPlayer)
4. Drop `nextResetAt`, `rsvpCutoffSent` from Event
5. GameHistory table stays read-only for null-snapshot entries (or drop once confirmed empty)

## What Gets Removed
- `GameHistory` model (replaced by Game with status "played")
- `PlayerRating` model (absorbed into EventPlayer)
- `Player` model (replaced by EventPlayer + GameParticipant)
- `nextResetAt` on Event
- `rsvpCutoffSent` on Event
- The destructive reset transaction (deleteMany)
- `teamsSnapshot` / `paymentsSnapshot` JSON columns
- RSVP answer broadcast notifications
- Player join/leave notifications to followers

## Rollback Plan
- Phase 1 is additive. Drop new tables + column to rollback.
- Phase 2 is feature-flaggable. Revert reads to old tables.
- Phase 3 is irreversible — only execute after Phase 2 is validated.
