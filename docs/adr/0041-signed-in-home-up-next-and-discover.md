# ADR 0041 — Signed-in Home: Up next + Discover

Status: accepted (2026-09-24)

## Context

The signed-in default surface was not useful. On web, a signed-in user who hit
the logo landed on `/` — a prerendered marketing page with a create-event form —
and had to navigate to `/dashboard` ("My Games") for anything real. On Android
the `games` route was already the signed-in start destination, but it opened on
a flat relationship-grouped list (owned / admin / followed) with no sense of
"what's next".

The request was to make the default page actively useful: show the next Games
the user is playing, offer a glimpse of Games they could join, and give a clear
path to the public listing. Three facts shaped the design:

1. `/api/me/games` returns only **owned / admin / followed** — not
   **participation**. "Games I'm playing" (roster `EventPlayer.userId`) was only
   surfaced on the user profile.
2. `/api/events/public` ordered `dateTime: asc` and included **past** Events
   (oldest first), so it could not back a "games to join" strip.
3. `/` is `prerender = true` (static/SEO), and the create-event form lived only
   on the landing page — so hiding marketing from signed-in users had to keep a
   create affordance reachable.

## Decision

Turn the signed-in default surface into **Home** (web `/dashboard`, Android
`games` route; route keys unchanged) with three bands:

1. **Up next** — Games the user is *playing or organizing*: Events where the user
   is a Participant (roster `EventPlayer.userId`), Owner, or Admin. One row per
   Event, deduped, `in_progress` pinned first ("Live now"), then kickoff
   ascending, capped at 3. Followed-only Events are *not* Up next.
2. **Discover** — a glimpse of Discoverable Events the user could join: public,
   not archived, kickoff in the future, spots remaining, excluding Events the
   user is already involved in (playing, organizing, following). Soonest-first,
   capped at 3, ending with a "Browse all public games" link to `/public`.
3. **Manage my games** — the previous relationship grouping (owned / admin /
   followed, plus archived) moved into a collapsed section below the fold.

Supporting decisions:

- New **`GET /api/me/home` → `{ upNext, discover }`**, computed server-side so
  ranking and exclusion are a single source of truth shared by web and Android.
  `/api/me/games` is unchanged and still backs the Manage section.
- **Fix `/api/events/public`** to be future-only and soonest-first via a shared
  `discoverableEvents.server.ts` helper (it previously returned past Events,
  oldest first — a bug).
- **Signed-in `/` redirects (client-side) to `/dashboard`**; anonymous visitors
  keep the static landing for SEO. The header logo points at `/dashboard` when a
  session exists. The create-event form is reachable from Home (dialog).
- **iOS and Wear are out of scope** this round (iOS follow-up filed; Wear has no
  public-discover affordance).

## Considered Options

- **New `/home` route** — rejected: churns robots, canonical URLs, i18n, and
  ADR 0012's post-login destination for no user-visible gain. Relabel the
  surface, keep the URLs.
- **Extend `/api/me/games` with a `playing` group** — rejected: the feed's
  ordering, `in_progress` pinning, and Discover exclusion are cross-cutting; a
  dedicated endpoint keeps that logic server-side and one test surface.
- **Drop `prerender` on `/` and SSR the redirect** — rejected: loses the static
  SEO landing for anonymous crawlers; the client-side bounce is sufficient.
- **Include followed-only Events in Up next** — rejected: following is not
  playing; it stays in Manage.
- **Show payment/score/MVP "needs action" badges in Up next** — deferred: those
  are post-kickoff concerns and each costs a per-event ledger read.

## Consequences

- `/dashboard` (web) and `games` (Android) are now the signed-in home on every
  platform; the tab label reads "Home".
- `GET /api/me/home` is auth-only, cap 3 + 3, and network-first on Android (no
  new Room entity — the feed is inherently live; offline degrades by keeping the
  last value and omitting Discover).
- `/api/events/public` no longer returns past Events; any client relying on the
  old oldest-first/past-inclusive behaviour must adapt (web `/public` is the
  only consumer today).
- `CONTEXT.md` gains **Home**, **Up next**, and **Discover**; the old
  "My games dashboard" term is retired (the grouping survives as Manage).
- `feature-parity.yaml` gains a top-level `home` entry (`up-next`,
  `discover-strip`); Wear is `false`.
