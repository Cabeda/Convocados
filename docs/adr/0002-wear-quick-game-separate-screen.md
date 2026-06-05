# Separate QuickScoreScreen for detached Wear OS scoring

The existing `ScoreScreen` is tightly coupled to a server-side Game entity — it fetches teams, syncs scores via `ScoreSyncWorker`, and requires an `eventId` for all operations. We considered reusing it with a special local-only ID and conditionals (option A) vs. creating a dedicated `QuickScoreScreen` (option B).

We chose option B: a separate `QuickScoreScreen` that shares UI composables (score tap areas, timer arc, haptic feedback) extracted into reusable components, but has its own ViewModel with no API/sync dependencies. Quick Game state uses `SavedStateHandle` only — no Room persistence, no network calls.

Reasons:
- ScoreScreen's sync, team-fetching, and event-loading logic would require pervasive `if (isLocal)` branching
- Quick Game doesn't need teams, game settings from server, or offline-queue sync
- Shared UI is extracted as composables, keeping DRY where it matters (presentation) without coupling data concerns

Trade-off accepted: two screen files with some structural similarity, in exchange for clean separation of concerns and no risk of Quick Game accidentally triggering sync or API calls.
