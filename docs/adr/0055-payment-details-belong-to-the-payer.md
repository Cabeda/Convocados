# 0055 — Payment details belong to the payer, not the event

**Status:** Accepted
**Date:** 2026-10-27
**Source:** grilling session, 2026-10-27

## Context

Convocados announces money, it never processes it. `game_payer_set` tells a webhook
subscriber who is owed how much, and the subscriber renders the instruction (ADR 0051).
Which account to pay comes from `EventCost.paymentMethods` — a list the organizer types
once per Event — so the payload describes the *organizer's* account no matter who actually
fronted the cost. When a player other than the organizer pays, the group is told "pay Ana"
and handed the organizer's Revolut link.

`Game.payerEventPlayerId` already identifies the creditor per Game, and an `EventPlayer`
knows its `userId`. What did not exist was the creditor's own details: `User` had no phone
and no payment fields, and there was no way for a person to say "show this to my crew".

Two further gaps surfaced while designing the fix. Nobody is ever told they have been made
Payer — there is no `payer_assigned` notification, only the outbound webhook — and the
Payer role carries across a recurrence only when the previous Game's payer is still an
active participant, dropping `payerExternalName` and dropping everything on cancel.

## Decision

**A person's payment details belong to that person.** They live on the `User`, are shared
only with consent, and are resolved per Game from the person who is actually owed the
money.

- **One detail type set, reused.** The existing six types (`phone`, `mbway`,
  `revolut_tag`, `revolut_link`, `cash`, `other`) are the vocabulary for both the per-User
  details and the event-level fallback. No new validator, no second deep-link table.
- **`User.phone` is canonical, unverified.** An `mbway` entry pre-fills from it and may
  override it per entry. Verification is a bigger feature than this Change; the number is
  payer-provided either way.
- **Precedence, highest first:** per-occurrence temporary override → the Payer's own
  details → the Event's details → nothing. The temporary override stays an explicit
  one-week instruction by the owner; the event-level list survives as a fallback because
  an external Payer has no account to hold details of their own.
- **Consent is explicit and off by default.** Details saved in a profile are not shared
  until the person turns on "share my payment details when I'm the payer", and they can
  switch it off for a single Event (the crew that must not receive them). The switch shows
  the exact payload before it is enabled, and names the audience — the Event's webhook
  subscribers — rather than "the app".
- **One projection, two events.** `game_payer_set` and `payment_nudge` carry the same
  resolved details, built by one function. Nothing else does: `payment_organizer_alert` is
  the owner's own summary and needs no payment target. `game_payer_set` keeps its existing
  gate — it fires only once a Game has ended and only when the cost is above zero.
- **The prompt is sited where money is already being discussed.** When the Payer has no
  details, the add-details form is reachable from the payments page payer card and from the
  existing payer check-in (#1236). Skippable, and it never blocks marking the group paid.
- **`Event.defaultPayer` is added**, seeded onto each new Game and still overridable there.
  Recurrence carries it for linked and external payers alike, and cancel stops losing it.
- **Any active roster player may claim the Payer role, at any time**, with the change
  attributed. This is the owner's call, taken against the recommendation to restrict claims
  to owner/admin after kickoff.
- **The Payer is settable before the Game starts.** Today every payer control is hosted by a
  post-game surface — the payments page lists only Games whose `dateTime` has passed, and the
  post-game banner and history card appear only after the Game ends — so a crew cannot
  organise itself in advance. The control moves onto the event page's payment row and onto
  the home page's game card, sharing one component. Android is a linked follow-up (#1566),
  because it has no payer-setting UI at all.
- **A Payer may stand down for one Game.** Standing down withdraws the commitment without
  erasing the identity: the Game keeps `payerEventPlayerId` and is marked **Vacant**, so
  anyone on the roster can claim it and the Owner still knows who to ask back. The Default
  Payer is untouched and seeds the next Game. Nulling the payer or flipping the Game to
  `untracked` were both rejected — `tracked` requires exactly one payer, and clearing it
  manufactures an invalid Game.

## Considered options

- **Leave details on the Event only.** Rejected: the payload would keep pointing the group
  at an account belonging to someone who is not owed the money.
- **Implicit consent — sharing because the details exist on the profile.** Rejected: it
  publishes a number a person never entered for that Event, to URLs they do not know about.
- **Restrict self-service claims to owner/admin once the Game is underway.** Recommended and
  rejected; see the risk below.
- **Clear the payer, or flip the Game to `untracked`, when the Payer stands down.** Rejected:
  the first breaks the `tracked`-requires-one-payer invariant, and the second silently
  changes what everyone owes for that Game.
- **Ship IBAN and PayPal in v1.** Deferred to #1550. There is no field-level encryption, and
  `litestream.yml` carries no `age` encryption, so a bank account number would sit in
  plaintext SQLite and in every R2 replica. The type set waits for an encryption decision.

## Consequences

- **The fallback can still misdirect money.** A Payer who is not the owner, sharing nothing,
  falls back to the Event's details — the organizer's account. Accepted, with the check-in
  prompt as the mitigation. A reader who finds this surprising should read it as deliberate.
- **A self-service claim after kickoff is a misdirection vector**: any roster member can
  make themselves the creditor while the group still owes. The only v1 guards are the
  attribution on the change and the payer card being visible on the payments page. The
  notification to the displaced payer is #1551, which is why the stand-down half waits on it.
- **The displaced Payer is not told**, and neither is the Payer when first assigned. Both
  need a notification job type and six locales, so both are tracked in #1551.
- **#1551 is a prerequisite for the stand-down half, not for the claim half.** A stand-down
  nobody hears about is a quiet unset: the group keeps assuming the default payer is
  collecting and does not organise itself, which is the whole point. The claim half can ship
  without it; "Bruno can't this week — who's collecting?" cannot.
- No new webhook event types are introduced. Both `game_payer_set` and `payment_nudge` already
  exist in `src/lib/webhookEvents.ts`, so the obligation is narrower than a catalogue change:
  the resolved-details fields must be added to their two rows in
  `src/pages/docs/api/webhooks.astro` in the same Change that emits them. ADR 0051 makes that
  page the public contract, and `paymentMethods` keeps its name — renaming it would break
  every existing subscriber.
- `User.phone` is the first phone number the app stores, and the first contact datum on the
  profile that is not a credential. `User.email` already exists and is already exported and
  deleted; the new field joins those paths rather than opening them.
- Six locales. Web ships first; `:app` is a linked follow-up (#1566) rather than a silent
  gap, because it has no payer-setting UI to extend. `:wear` has no profile screen and no
  push channel, so there is nothing to bring into parity there.
