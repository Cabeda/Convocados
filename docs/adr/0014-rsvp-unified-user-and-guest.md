# Single Rsvp table for both users and guests

The `Rsvp` table is keyed on exactly one of `{userId, playerId}` (both nullable, exactly one set per row). A row keyed on `userId` is the User's own response; a row keyed on `playerId` is an admin/owner setting attendance on behalf of a **guest Player** (a `Player` with `userId IS NULL`). `respondedByUserId` audits the actor for the guest case.

The original `Rsvp` schema had `userId` non-nullable, which could not represent guest Players. We considered two alternatives:

1. **Two tables** (`UserRsvp`, `GuestRsvp`) — clean separation, but duplicated code (two upserts, two summaries, two recipient-set joins), and a third cross-cutting endpoint for the "summary chips" the organizer sees.
2. **Discriminator column** (`subjectType: "user" | "player"` + `subjectId`) — same idea as #1, wrapped behind a single Prisma model, but loses referential integrity (Prisma can't FK on a polymorphic `subjectId`).

The chosen approach (two nullable FKs + an application invariant) keeps a single `@@unique` per kind, a single upsert function per kind, a single `getRsvpSummary` over the union, and a single `respondedByUserId` audit column for the admin-on-behalf case. The application invariant (`userId IS NULL XOR playerId IS NULL`) is enforced in `upsertRsvp` / `upsertGuestRsvp` because SQLite's NULL semantics in unique constraints would otherwise allow multiple `(userId=NULL, eventId=X)` rows.

This decision locks in: (a) every `Rsvp` row has exactly one subject, (b) admin writes on behalf of guests are audited, (c) the recipient set is computed separately for users (followers ∪ linked players ∪ owner) and guests (active `Player` rows with `userId IS NULL`).
