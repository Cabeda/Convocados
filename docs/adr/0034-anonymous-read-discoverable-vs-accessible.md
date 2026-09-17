# ADR 0034 — Anonymous read access: discoverable vs accessible

Status: accepted (2026-09-17)

## Context

AI agents (ChatGPT browsing, crawlers, LLM docs readers) need anonymous,
read-only access to Convocados data. Q11 surfaced a modelling gap: the Event
model has a single visibility flag, `isPublic`, plus an optional
`accessPassword` (`prisma/schema.prisma:122`, `:173`). Three behaviours exist in
the product but only two are named:

1. **Listed** — `isPublic = true`; appears in `/public`, `/api/events/public`,
   the sitemap, and agent indexes.
2. **Link-only** — `isPublic = false`, no password; not listed anywhere, but
   anyone holding the URL can read the roster anonymously. This is the core
   share-a-link affordance — there are no accounts required to view a game.
3. **Password-locked** — `accessPassword` set; the roster requires a session,
   invite, or password bypass.

The initial proposal was to gate anonymous reads on `isPublic`. That would have
made every link-only event unreadable to signed-out visitors and broken
share-a-link for private events. The flag was being asked to mean "readable",
which it does not.

## Decision

Treat `isPublic` as **discoverability**, not **accessibility**.

- Anonymous callers may read any event by id unless it is password-locked.
- `isPublic` controls only whether an event appears in listings, the sitemap,
  and the `/llms.txt` agent index.
- Password-locked events answer anonymous reads with `{ "locked": true }`.
- The anonymous event payload carries no account emails, no password hash, and
  no per-player payment data.

The same model is published to agents in `/llms.txt` (generated from
`openapi.ts` + `docsNav.ts`) and enforced by tests:
`src/test/api.test.ts` (no-PII regression for an unlisted event) and
`src/test/openapi.test.ts` (anonymous operations declare `security: []`).

## Considered Options

- **Gate anonymous reads on `isPublic`** — rejected: breaks link-sharing for
  private events, the product's primary distribution mechanism.
- **Add a third visibility state (public / unlisted / password)** — rejected:
  `accessPassword` already expresses the third state orthogonally, and a
  second flag would duplicate it. The model needed naming, not more fields.
- **New anonymous-only projection route** — rejected: the existing payload is
  already PII-free; a regression test is the cheaper guarantee.

## Consequences

- `GET /api/events/{id}` keeps one payload for all viewers; anonymity is a
  field-level property, not a separate shape.
- Agents discover events only through listings; they can fetch an event by id
  only when given the link. Event ids are cuids, so listing is the only
  enumeration path.
- `/llms.txt`, `robots.txt`, and the sitemap become the discovery surface for
  crawlers; `/api/` stays `Disallow`-ed except for explicitly allowed read paths.
- Any new anonymous operation must declare `security: []` in `openapi.ts` or it
  is invisible to `/llms.txt` and fails the spec test.
