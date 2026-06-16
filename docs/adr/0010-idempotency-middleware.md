# 0010 — Idempotency middleware for add-player

**Status:** Accepted
**Date:** 2026-06-16

## Context

`POST /api/events/[id]/players` is the only manager-initiated add path on the
web and Android apps. The endpoint is idempotent in effect (the
`Player.@@unique([eventId, name])` constraint de-duplicates by name) but not
in contract: a network retry of the same logical "add Alice" can return 409
on the second attempt, which the client surfaces as a soft error in the
`playerError` Alert. The issue is amplified by the new confirmation dialog
(see ADR 0011), which is followed by an `addPlayer` call; on flaky networks
the user can confirm once and see a misleading "duplicate" error from a retry
the browser fired automatically.

We need true idempotency: same `Idempotency-Key` + same payload returns the
same response, without re-doing the work or re-firing side-effects
(notifications, `EventLog`, webhooks).

## Decision

Add a small server-side idempotency middleware, opt-in via the
`Idempotency-Key` request header, scoped to `POST /api/events/[id]/players`
in v1.

**Storage**: an in-process `Map<string, CachedResponse>` in module scope of
`src/lib/idempotency.ts`. The map entry stores the cached status, body,
payload hash, and expiry timestamp. A periodic sweep (every minute) evicts
expired entries. The map is bounded by the 5-minute TTL — no explicit size
cap because the natural rate of adds is low and the cache self-cleans.

**TTL**: 5 minutes. Long enough to cover a browser-driven retry storm (the
typical `fetch` retry window is sub-minute); short enough to bound memory.

**Cache key**: `key + endpoint-path + session-userId`. A
`POST /api/events/{A}/players` and `POST /api/events/{B}/players` with the
same UUID never collide. Two different users reusing the same UUID also do
not collide.

**Payload hash**: SHA-256 of the canonicalized body. Canonicalization is
trimmed-whitespace `name`, sorted-key JSON, omitting absent optional fields
(`linkToAccount`, `email`). The hash is computed on read; the original
request body's keys must match the original (or be absent) for a cache hit.

**Status caching**: only `2xx` responses are cached. A 5xx or 4xx is treated
as a miss on the next request with the same key, allowing genuine retries
to succeed.

**Key generation**: client-side UUIDv4 per logical add. The web
`addPlayer` callback and the Android `EventDetailViewModel.addPlayer` both
generate a fresh UUID per call and pass it as the `Idempotency-Key` header.

**Concurrent in-flight**: first-writer-wins. If a request with key `K` is
still processing and a second request arrives with key `K`, the second gets
`425 Too Early`. The client's `useRef` in-flight guard (in
`EventPage.addPlayer`) normally prevents this; the 425 is defense-in-depth.

**Mismatch**: same key, different payload hash → `422 Unprocessable Entity`
with `{ error: "Idempotency-Key reused with different payload" }`. The
client treats this as a 5xx-equivalent and shows the generic error
snackbar.

**Wrapping**: handlers opt in by calling `withIdempotency(ctx, handler)`
from `src/lib/idempotency.ts`. The wrapper:
1. Reads the `Idempotency-Key` header. If absent, the handler runs without
   caching (backwards-compatible: old clients still work).
2. Computes the payload hash from the request body.
3. Looks up `key + path + userId` in the map. If a hit matches the hash,
   return the cached response.
4. If a hit mismatches the hash, return 422.
5. Otherwise, run the handler. If the result is 2xx, store it in the map
   with `expiresAt = Date.now() + 5 * 60 * 1000`. If non-2xx, do not store.
6. Return the result.

### Alternatives considered

- **Prisma `IdempotencyKey` model** — durable and multi-process safe, but
  requires a migration, a cleanup job, and an extra round-trip per write.
  The project is single-process (Litestream-backed single VM). In-process
  wins on simplicity; the migration path to a DB-backed cache is local
  (wrap behind the same `getCachedResponse` / `storeCachedResponse`
  functions).
- **No middleware, rely on `Player.@@unique([eventId, name])`** — already in
  place, but the second attempt returns 409 with a generic error message.
  Users see "duplicate" instead of "added ✓". Reject: the UX cost is real
  on flaky networks.
- **Browser-only retry suppression** (e.g. `AbortController` and disable
  the button) — covers the common case but not the "user opens a second
  tab and re-confirms" path, and not the "browser retries after a network
  blip" path. Server-side idempotency is the only defense that works
  regardless of client behavior.

## Consequences

- `src/lib/idempotency.ts` is a new module; small (~80 lines + types).
- `src/pages/api/events/[id]/players.ts` is wrapped. Existing tests in
  `src/test/api.test.ts` and `src/test/auth-api.test.ts` continue to pass
  (back-compat: clients without the header are unaffected).
- New tests: `src/test/idempotency.test.ts` covers replay, payload
  mismatch, expiry, missing header, and concurrent in-flight (425).
- `src/lib/openapi.ts` documents the optional `Idempotency-Key` header on
  the `POST /api/events/{id}/players` operation.
- A new Bruno collection under `bruno/events/idempotency/` exercises the
  contract: replay returns the cached body, payload mismatch returns 422.
- Memory bound: the map is small in practice. Worst-case a burst of 10k
  adds in 5 minutes is ~10 MB. Acceptable.
- Failure mode: an in-process map is lost on server restart. A request in
  flight at restart time returns a generic 5xx to the client. No
  catastrophic data loss (the add either happened or didn't; idempotency
  cache loss is a UX issue, not a correctness issue).
- Horizontal scaling: a second Astro instance does not share the cache.
  Idempotency degrades to "best effort" across instances. Documented
  limitation; the migration to a Prisma `IdempotencyKey` is the fix when we
  ever scale out.
