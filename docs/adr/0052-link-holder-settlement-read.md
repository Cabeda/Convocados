# ADR 0052 — Reading an ownerless Event's settlement summary by link

**Status:** accepted
**Date:** 2026-10-15

## Context

ADR 0035 grants a *mutation* capability: on an Event with `ownerId === null && !isPublic`,
the share link **is** the capability. That is this product's no-account create-and-manage
model — the link is the secret, not a door.

ADR 0035 says nothing about **reads**. The settlement summary route (`GET
/api/events/[id]/payments/settlement`) enforced a stricter rule than the mutation routes:
an unauthenticated caller got 401, and a non-participant got 403, regardless of whether
the Event was ownerless and unlisted. That rule was deliberate — GH-1394 restored it
after a refactor quietly widened it to the manager role — and it held for a while.

The result was incoherent. On a no-account Event, a link holder could **settle a share**
(mark someone as paid, a mutation ADR 0035 explicitly permits) but could not **read** who
had paid. The one thing they could do, they could not see. That is administration, not
safety: the capability exists, only visibility is missing.

Product decision, 2026-10-15: the link holder may read the summary, restricted to the
**basic** view.

## Decision

`GET /api/events/[id]/payments/settlement` honours the ADR 0035 `ownerless-open` role for
reads, mapped onto the existing **non-manager** role. The shared summary builder already
handles a viewer with no identity correctly, so this needs no new role and no new
filtering branch.

What a link holder sees:

- Who played, and who paid each Game (the payer/receiver side stays public).
- Their own debt lines, if they hold an identity. A link holder has none.

What they do **not** see:

- The manager view — every debtor's names, amounts and per-game rows.
- Any aggregate that describes what others owe: per-game `total` and `debtorCount`, and
  `totals.totalOwed` are zeroed for a reader with no identified person.
- Any per-person `owedAmount` other than their own, which they cannot have without an
  identity.

An **ownerless public** Event (an Open Pickup) is not covered: it is discoverable via
`/api/events/public`, so openness there is an open door, not a secret, and the route keeps
rejecting it. An owned Event is unaffected.

## Consequences

- The read surface and the mutation surface are now consistent, so the capability is
  legible in one place: the link is the capability, on both.
- A link holder learns whether the Game is solvent and who has paid — the information
  needed to act on an unmanaged Event — and nothing about who is behind on paying.
- **The aggregates are the load-bearing part.** Debtor names, per-game rows and
  `lines[].role` were already protected; `total`, `debtorCount`, `owedAmount` and
  `totalOwed` were not, and a claim of "payers only" that omits them is false. The tests
  assert each is zero, not merely that names are absent.
- This decision is a read policy in its own right, not an inference from ADR 0035. Any
  future route extending link-holder access should cite this ADR for reads and ADR 0035
  for mutations, separately.

## Considered Options

- **Close the read again.** Rejected: it leaves the capability incoherent, which AGENTS.md's
  mission test answers directly — a link holder who can settle but not read is being handed
  administration.
- **Grant the manager role.** Rejected: it exposes every debtor's name and amount to a bare
  link, and it is the exact regression GH-1394 was sent back for.
- **Require authentication.** Rejected: the Event is unmanaged by definition. Requiring an
  account to read it contradicts the no-account model the Event was created under.
