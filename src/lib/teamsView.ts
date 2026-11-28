/**
 * Pure view rules for the Teams block and the "Play again?" block of the event page. No React,
 * no I/O: tested in `src/test/teamsView.test.ts`, and the components only render what these say.
 */

import { findSelfRosterRow } from "./eventView";

/** The names every new event starts with: a group that never renamed its teams sees "Team 1" and "Team 2". */
const STOCK_NAMES = ["Ninjas", "Gunas"] as const;

export type TeamTitle = { custom: false } | { custom: true; name: string };

/** What a team column is called: its own name when the group chose one, else a plain "Team 1" / "Team 2". */
export function teamTitle(name: string, index: number): TeamTitle {
  return name === STOCK_NAMES[index] ? { custom: false } : { custom: true, name };
}

/** The stored name a team has when the group never chose one; saving an empty name puts a team back to it. */
export function defaultTeamName(index: number): string {
  return STOCK_NAMES[index] ?? "";
}

/** Which team (0 or 1) the viewer plays in, matched through their account first and by name only as a fallback. */
export function viewerTeamIndex(
  teams: ReadonlyArray<{ members: ReadonlyArray<{ name: string }> }>,
  players: ReadonlyArray<{ id: string; name: string; userId?: string | null }>,
  viewer: { id: string; name: string } | null,
): number | null {
  const row = findSelfRosterRow([...players], viewer);
  if (!row) return null;
  const index = teams.findIndex((team) => team.members.some((m) => m.name === row.name));
  return index === -1 ? null : index;
}

/** Drawing needs at least two names; below that the control says so instead of disappearing. */
export function drawGate(count: number): { ok: true } | { ok: false; reason: "needTwo" } {
  return count >= 2 ? { ok: true } : { ok: false, reason: "needTwo" };
}

/**
 * What a tap on "Draw" does: ask before replacing teams that exist, ask before drawing from a list that is
 * not full yet, and draw at once otherwise.
 */
export function drawStep(i: { hasTeams: boolean; count: number; max: number }): "redraw" | "early" | "now" {
  if (i.hasTeams) return "redraw";
  return i.count < i.max ? "early" : "now";
}

/** The rating next to a name shows only for a balanced game, and only when the organizer has not hidden it. */
export function showRatings(e: { balanced: boolean; hideEloInTeams: boolean }): boolean {
  return e.balanced && !e.hideEloInTeams;
}

export type PlayAgainView = { kind: "manage" } | { kind: "ask"; owner: string | null };

/** After a one-off game: managers choose; everyone else is told who to ask. */
export function playAgainView(i: { canManage: boolean; ownerName: string | null }): PlayAgainView {
  return i.canManage ? { kind: "manage" } : { kind: "ask", owner: i.ownerName };
}
