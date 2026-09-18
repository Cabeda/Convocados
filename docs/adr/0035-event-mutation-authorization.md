# ADR 0035 — Event mutation authorization: owner/admin, with ownerless-open only while unlisted

Status: accepted (2026-09-17)

## Context

A security review found a guard copied across ~30 event routes:

```ts
if (event.ownerId && !isOwner && !isAdmin) return 403;
```

When `event.ownerId` is `null` the condition is false, so the guard never
blocks. Ownerless events are a real production state: `POST /api/events`
allows anonymous creation and stores `ownerId: session?.user?.id ?? null`, and
the UI exposes open management of them (`EventPage.tsx`: `isOwnerless =
!event.ownerId; canEditSettings = isOwnerless || isOwner || isAdmin`). This is
the product's "no accounts needed" model — the share link is the secret.

The review also found routes with **no** authorization at all (`randomize`,
`undo-remove`, `webhooks/[webhookId]/test`, `webhooks/[webhookId]/deliveries`)
and an IDOR in `me/calendar-token`.

Removing the `ownerId &&` prefix outright would make an anonymously-created
event unmanageable by its own creator (4 E2E flows rely on it), so the
fail-open cannot simply be deleted.

## Decision

An event mutation is authorized when the caller is the Owner or an Admin, **or**
when the event is **ownerless and unlisted**:

```ts
const ownerlessOpen = event.ownerId === null && !event.isPublic;
if (!isOwner && !isAdmin && !ownerlessOpen) return 403;
```

- **Owned events:** owner/admin only. A non-owner is rejected.
- **Ownerless, unlisted events:** open. The share link is the capability; this
  preserves the no-account create-and-manage flow.
- **Ownerless, public events:** rejected until adopted. Open Pickups are created
  `isPublic: true, ownerId: null`, so they are discoverable via
  `/api/events/public`; openness there is not a secret, it is an open door.

Additionally:

1. `randomize`, `undo-remove`, `webhooks/*/test`, `webhooks/*/deliveries` now
   apply the same rule (they had no check at all).
2. `POST /api/me/calendar-token` with `scope=event` requires owner, admin, or
   participant (was: any authenticated user, for any event).
3. `POST /api/push/app-token` never rewrites `userId`; a token registered to
   another account returns 409.
4. `gameId` in the settlement and no-show bodies must belong to the event in the
   path.
5. `access/verify` uses the stricter `auth` rate-limit preset (10/min).

## Considered Options

- **Remove the guard entirely (accounts required to manage)** — rejected: it
  breaks the core no-account flow; adopted events already behave this way, but
  anonymous creation is a product feature.
- **Keep the guard as-is** — rejected: ownerless public events (Open Pickups)
  are discoverable and were mutable by anyone.
- **Per-event creator token** — the most complete fix (proves the anonymous
  creator without an account) but a larger change; noted as a future option.
  Policy B closes the discoverable-tampering hole with far less surface.

## Consequences

- Ownerless unlisted events remain fully manageable by link holders; this is
  intentional and unchanged.
- Ownerless public events are read-only until adopted/claimed.
- New event mutations must use the shared condition; `src/test/authz-regressions.test.ts`
  pins anonymous/non-owner/ownerless-public rejection and the ownerless-unlisted
  allowance.
- Out of scope, tracked separately: public `GET payments`/`GET cost` payloads,
  name-based participant identity for MVP/history edits, private-IP validation
  for webhook URLs, and `profileVisibility` enforcement.
