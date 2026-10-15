/**
 * The Roster's active/bench rule, as one pure function over an ordered Roster.
 *
 * GLOSSARY: a Roster is the ordered list of players on an Event's current Game —
 * active spots first, bench past `maxPlayers`. This module owns that split and the
 * capacity arithmetic that follows from it, so every surface that already holds the
 * Roster as an array (web, MCP write tools, team draws) answers "who is active, who
 * is on the bench, how many spots are left" the same way instead of re-slicing
 * `slice(0, maxPlayers)` inline.
 *
 * Two forms of the same rule, agreeing by construction:
 * - `splitRoster` — the in-memory form, below. Client-safe: no server imports.
 * - `getRosterCapacity` (in `roster.server.ts`) — the query form. It filters the
 *   Roster first (archived rows, invite ghosts, ADR 0016 legacy `Player`
 *   accumulation) and then hands the survivors to `splitRoster`, so the two can
 *   never disagree.
 *
 * This is deliberately client-safe and dependency-free: the filtering lives in the
 * query form because only it knows the shape a row comes back from the database in.
 */

export interface RosterSplit<T> {
  /** The first `maxPlayers` members — the active spots. */
  active: readonly T[];
  /** Every member past `maxPlayers` — the bench, in Roster order. */
  bench: readonly T[];
  activeCount: number;
  benchCount: number;
  /** Roster size, active plus bench. */
  totalCount: number;
  /** Active spots still unclaimed: `maxPlayers - activeCount`, never negative. */
  spotsLeft: number;
  hasBench: boolean;
}

/**
 * Split an already-filtered, ordered Roster into active spots and bench.
 *
 * The caller must hand over the *filtered* Roster — rows a player has left
 * (archived) and invite ghosts (`status === "pending"`, ADR 0025) are already out.
 * `getRosterCapacity` is the entry point that does that filtering; use it whenever
 * the Roster has not been fetched yet.
 */
export function splitRoster<T>(roster: readonly T[], maxPlayers: number): RosterSplit<T> {
  const activeCount = Math.min(roster.length, Math.max(0, maxPlayers));

  return {
    active: roster.slice(0, activeCount),
    bench: roster.slice(activeCount),
    activeCount,
    benchCount: roster.length - activeCount,
    totalCount: roster.length,
    spotsLeft: Math.max(0, maxPlayers - activeCount),
    hasBench: roster.length > activeCount,
  };
}