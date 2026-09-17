# ADR 0035 — Event mutations require owner/admin; ownerless events authorize nobody

Status: accepted (2026-09-17)

## Context

A security review found a guard copied across ~30 event routes:

```ts
if (event.ownerId && !isOwner && !isAdmin) return 403;
```

When `event.ownerId` is `null` the condition short-circuits to false, so the
guard never blocks. Ownerless events are a real production state: Open Pickups
are created by the Playtomic sweep with `ownerId: null`
(`src/lib/pickupSweep.server.ts`). On those events **anyone — including
anonymous callers — could mutate settings, payments, webhooks, history and
ratings.**

The same review found routes that skipped authorization entirely
(`randomize`, `undo-remove`, `webhooks/[webhookId]/test`,
`webhooks/[webhookId]/deliveries`) and an IDOR in `me/calendar-token`
(any authenticated user could mint a feed token for any event).

## Decision

1. **Event-scoped mutations require the caller to be the event Owner or an
   event Admin.** The `event.ownerId &&` prefix is removed everywhere; a null
   owner authorizes nobody. Ownerless events must be adopted/claimed (which
   establishes an owner) before anyone can change them.
2. **Players may remove themselves**, and only themselves. `DELETE .../players`
   is gated on `isSelf || isOwner || isAdmin` — the guard is no longer nested
   inside `if (player.userId)`, which had let anonymous callers remove guest
   players.
3. **Server-side-fetch routes are organizer-only.** `webhooks/*/test` and
   `webhooks/*/deliveries` require owner/admin.
4. **Calendar feed tokens are scoped to people involved in the event.**
   `POST /api/me/calendar-token` with `scope=event` requires owner, admin, or
   participant.
5. **Push tokens are not transferable.** `POST /api/push/app-token` never
   rewrites `userId` on an existing token; a token registered to another
   account returns 409.
6. **`gameId` in a body must belong to the event in the path.** Settlement and
   no-show routes validate `game.gameId === eventId` to stop cross-event writes.
7. **Password attempts use the stricter `auth` rate-limit preset** (10/min)
   instead of `write` (30/min).

## Considered Options

- **Allow anyone to mutate ownerless events until adopted** — rejected: an
  unowned event has no accountable party, and anonymous writes to payments and
  history are not recoverable.
- **Introduce a system/service account as the owner of pickups** — rejected for
  now: it hides the ambiguity rather than resolving it, and changes the Open
  Pickup lifecycle (ADR 0021). Revisit if a background process ever needs to
  mutate an unowned event.
- **Keep per-route guards but standardize the condition** — rejected: the bug
  was the repeated boolean, not the helper. Removing the `ownerId &&` prefix
  and testing the invariant is the durable fix.

## Consequences

- Ownerless events are read-only until adopted. The adopt/claim routes remain
  the only way to give them an owner.
- Any future event mutation must gate on `isOwner || isAdmin` (or an explicit
  ownership rule such as self-removal); a null owner is never an implicit pass.
- Regression tests assert anonymous and non-owner callers get 401/403 on the
  previously-open routes (`src/test/authz-regressions.test.ts` and the updated
  per-route suites).
- Out of scope, tracked separately: public `GET payments`/`GET cost` payloads,
  name-based MVP/history participant identity, and private-IP validation for
  webhook URLs (SSRF hardening).
