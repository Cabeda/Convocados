# Convocados — Domain Glossary

## Game / Event
A sports match or recurring session. The core entity. Used interchangeably.

## Player
A person registered to participate in a specific Game. Has a `name`, optionally linked to a `User` via `userId`. One user can be a Player in many games. "Joined" now refers strictly to participation (has a linked Player record) — distinct from "followed" which controls dashboard visibility.

## Owner
The User who created the Game or to whom ownership was transferred. Has full management control. A Game has exactly zero or one Owner.

## Admin
A User granted management privileges for a Game by the Owner (via `EventAdmin`). Can edit teams, archive players, approve ELO, etc. Has no ownership rights.

## Follow
An explicit relationship between a User and a Game (stored in `EventFollow`). Games a User follows appear on their "My games" dashboard. Distinct from "joined" (participation via Player record).

### Auto-follow rules (user-initiated only)
- Quick Join → follow
- Claim Player → follow
- Auto-link (owner adds, system recognizes user) → no follow
- Owner/admin adds you → no follow

### Auto-unfollow rules
- Self-removal → unfollow
- Event archived → unfollow
- Owner/admin removes you → no unfollow

## Quick Game
A purely local, ephemeral score-tracking session on Wear OS with interval alarms. Not connected to any server-side Game. Does not sync, has no teams, and does not require authentication. Lost when the user navigates away.

## My games dashboard
Shows games grouped by relationship:
- **Owned** — events where `Event.ownerId = userId`. Always visible. Includes archived.
- **Admin** — events where `EventAdmin.userId = userId`. Always visible. Archived events not shown.
- **Followed** — events where `EventFollow.userId = userId`. Archived events auto-unfollow.

Profile pages (`/api/users/[id]`) continue to show **joined** (participation via Player records), not followed.
