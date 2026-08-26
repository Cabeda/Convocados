# Guest invite links & claimable anonymous players

Status: accepted (2026-08-26)

## Context

Inviting a person without a Convocados account previously required them to
create one before they could even respond to an invitation — a signup wall in
front of a "come play football on Friday" message. Invites also defaulted to
email/push delivery, which is intrusive for friend-to-friend invitations.

## Decision

1. **Guest Invite Links.** An invite can target an Anonymous **EventPlayer**
   (no User). The token is the capability: unguessable, delivered by the
   inviter themselves (share sheet / WhatsApp / SMS). Convocados sends nothing.
2. **No signup wall to respond.** The invite page shows event info and
   Accept/Decline to anyone. Accepting as a guest activates the anonymous
   EventPlayer on the roster (bench semantics when full) with **no account and
   zero input fields**. Declining records RSVP=no against the anonymous row.
3. **One final answer per token.** Accept/decline is immutable until the Owner
   retracts and re-invites. Protected by the 32-byte token plus rate limiting —
   friends-of-friends threat model, no captcha.
4. **Claiming over silent binding.** A logged-in user opening a guest link gets
   an explicit choice: "Join as \<you\>" (claims the row for their account) or
   "Join as \<guest name\>" (accepts without claiming). The page never binds
   someone's name to the viewer's account silently. Claimed rows inherit all
   history; claim is refused if it would collide with existing identity data.
5. **Conversion is offered, never forced.** Post-accept guests get a one-time
   "keep your spot" card and a slim same-browser banner afterwards
   (`localStorage` marker). The claim door is Google one-tap → the existing
   bind endpoint; an email-capture door was deferred — the register flow is
   organizer/roster-gated and an open mail form on a public token page is a
   spam vector. Email-registered users bind later from the event page.
   Name matching only *suggests*, never auto-binds.
6. **Email is retired from invite delivery.** Game invites notify via push
   only when the invitee opted in on web/app; otherwise the inviter shares the
   link. `sendGameInvite` remains solely for register-invite emails.

## Considered options

- Forced account creation before responding (rejected: the wall was the bug).
- Ephemeral session cookie bound to the token (rejected: second identity
  mechanism beside User/EventPlayer; claim flow would need a third).
- Silent claim-by-name-match for logged-in viewers (rejected: mis-binding a
  stranger's roster spot to your account is worse than one extra tap).

## Consequences

- Unauthenticated POSTs now mutate rosters; the token + immutability + rate
  limits are the whole defence. Any future "resend to another person" feature
  must rotate tokens.
- Roster truth stays single-sourced in EventPlayer/GameParticipant; guests are
  ordinary anonymous players to every downstream surface (payments, teams,
  ELO) from day one.
- Same-browser recognition of an accepted guest is best-effort
  (`localStorage`); cross-device guests are simply unknown until they claim.
