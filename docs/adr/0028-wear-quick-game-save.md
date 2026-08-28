# Save a Wear quick game as an event history result

Status: Accepted

## Context

A Wear quick game is durable while it is in progress and can be promoted into an event's game history. The existing server contract creates or retrieves the event's watch history, then accepts a scalar or structured score update. The operation is two network calls and can fail between them.

## Decision

Save is an online promotion of one completed quick game into one compatible owner/admin event. The save screen presents only event categories known to be authorized for the Wear client; followed-only events are not save targets.

The quick game remains durable when saving fails, so the player can retry after correcting authentication or connectivity. The quick game is cleared only after history creation and score update both succeed. A successful save refreshes that event's history cache when possible and returns the user to Games rather than leaving an apparently active quick game on the back stack.

The existing POST-then-PATCH API contract remains unchanged. Save is online-only; no new offline queue or backend transaction is introduced. Standard quick scores remain valid for scalar-compatible events, while tennis/padel structured scores retain their existing compatibility and validation rules.

## Consequences

- A successful save cannot be accidentally repeated from the same durable quick-game state.
- Failed saves are retryable without losing the recorded quick score.
- The server may still contain an empty history if POST succeeds and PATCH fails; the client keeps the quick state and reports the failure for retry.
- History visibility depends on the post-save cache refresh; a refresh failure does not invalidate a score already accepted by the server.
- Users who only follow an event must use an authorized owner/admin/player flow elsewhere; the Wear save list avoids presenting a button that is known to reject followed-only access.
