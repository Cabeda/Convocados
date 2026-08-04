# ADR 0020 — Player Ordering and Priority Guaranteed Spots

## Status

Accepted

## Context

Production data for the recurring event "Ninjas da Areosa" (event
`cmmkfrx8b0000o2ixrix1yp2m`) showed the current game's player list at orders
`0, 1, 2, 3, 14` — a 9-slot gap. Issue #657 ("Player order issues").

The root cause is that `GameParticipant.order` was assigned from three
different, mutually inconsistent sources depending on the join path:

| Path | Order source | Problem |
|------|-------------|---------|
| Fresh join | `event.players.length` (event-wide count) | Grows across games — a player who never played before lands at order 14 while this week's regulars sit at 0-3 |
| Re-add / re-join | `gameParticipant.count()` (active count) | Collides with archived gaps left by players who left the game |
| Priority confirm | `order: 0` + `update: {}` | Two players can end up with the same order; a previously-archived participant stays archived (issue #625) |

The queue is game-scoped (ADR 0016): the Event is a series template, the Game
holds one occurrence, and `GameParticipant` is the per-game link. Order is a
per-game concept and must never be derived from event-wide state.

## Decision

### 1. Single source of truth for order

All GameParticipant order assignment goes through one helper,
`nextGameParticipantOrder(gameId)`, which returns `max(order) + 1` scoped to a
single game. Every join path — fresh join, re-add, re-join after leave,
priority confirm — appends at the end of the queue.

- Game-scoped: never drifts toward the event-wide Player count.
- Gap-safe: `max + 1` never collides with archived participants that kept
  their old slot, unlike `count()`.

### 2. Priority-confirmed players get a guaranteed active spot (evict-to-bench)

"Guaranteed spot" for a priority-confirmed player means: they always land in
an active slot (`order < maxPlayers`), never the bench. Implemented by
`grantActiveSpot(eventId, gameId, eventPlayerId, maxPlayers)`:

1. **Room available** (`activeCount < maxPlayers`): append at the end of the
   queue — the player is active.
2. **Game full** (`activeCount >= maxPlayers`): evict the **last non-priority
   active player** (highest order, not priority-enrolled) to the bench (end of
   queue), and give the priority player their slot.
3. **No eviction target** (all active players are priority): append at the end
   (bench). The priority cap (`priorityMaxPercent`) is the safety valve that
   makes this the exception rather than the rule.

Priority players are never evicted by another priority player. An anonymous
player (no linked user) is never priority, so they are always an eviction
target. The eviction cap on the active roster stays enforced by
`rankAndCap` (`maxPlayers * priorityMaxPercent / 100`), unchanged.

Teams are re-synced after any eviction/promotion: `validateTeams` removes
bench players from generated teams, `addPlayerToTeams` slots the newly-active
player in.

## Consequences

- Player list order is stable across join paths and game occurrences.
- A confirmed priority player is never on the bench, at the cost of the last
  non-priority active player dropping to the bench when the game is full.
- `event.players.length`, `gameParticipant.count()`, and literal `order: 0`
  are no longer used to derive GameParticipant order.
- Existing polluted data (gaps like `0,1,2,3,14`) is not backfilled by this
  ADR; it self-heals as players leave and rejoin, or via an owner reorder.

## Tests

- `src/test/player-order.test.ts` — regression tests for the prod gap and the
  count-based collision (both failed before this ADR, pass after).
- `src/test/priority-api.test.ts` — guaranteed-spot tests: append when room,
  evict last non-priority when full, never evict a priority player.
