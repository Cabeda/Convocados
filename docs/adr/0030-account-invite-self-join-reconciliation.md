# Account invite self-join reconciliation

Status: accepted (2026-09-02)

## Context

A registered User can already have a pending participation Invite for the current
Game. If that User opens the event and adds their own name, the self-join action
must be understood as accepting the existing invitation, not as a new roster
addition. Treating the typed name as a new identity can leave the Invite pending
while the User is active, or create duplicate event identities.

## Decision

1. An Event has one persistent EventPlayer identity per authenticated User.
2. A self-join for an account-targeted pending Invite is matched by the stable
   User identity. The typed display name is not an identity key.
3. The existing EventPlayer is reused. The current Game's pending participation
   is promoted to the active Player list, the Invite becomes accepted, and
   Attendance is recorded as yes.
4. Promotion is scoped to the Game being joined. Pending Invites for other Games
   in the same Event remain pending until separately accepted.
5. If another EventPlayer identity already belongs to the same User in the Event,
   the action returns a conflict. The system must not silently merge histories,
   payments, or team assignments.
6. Web and Android use the same backend behavior; clients refresh their roster
   from the resulting canonical state.

## Consequences

- Direct self-join and Invite-link acceptance converge on the same active roster
  semantics.
- Repeated self-join requests are idempotent at the invitation and participation
  level; they cannot create another account-linked EventPlayer for the Event.
- A future explicit merge flow remains responsible for resolving conflicting
  identities and their historical data.
