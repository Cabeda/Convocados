/**
 * "One page, one story" — pure view logic for the Next game block on the event
 * page. No React, no I/O: every rule here is unit-tested in
 * `src/test/nextGame.test.ts`, and the components only render what it says.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
/** The countdown ("Starts in 3 h 12 min") shows for the last day before kickoff. */
export const COUNTDOWN_WINDOW_MS = 24 * HOUR;
/** A timer wakes just after a boundary, never just before it. */
const SLACK_MS = 50;
/** setTimeout cannot wait longer than this; a longer wait is simply taken in two steps. */
const MAX_TIMEOUT = 2_147_000_000;

/**
 * What the block shows for this moment of the game:
 * - `open`: before kickoff — RSVP and lineup.
 * - `live`: kickoff to the end — the roster stays open, with a "Live now" pill.
 * - `signupsSoon`: a weekly game that has ended but not been reset yet. The roster is still the
 *   finished game's, so it is NOT shown as the next game.
 * - `none`: a one-off game that has ended — there is no next game.
 * - `cancelled`: nothing to join (the banner says so).
 */
export type NextGamePhase = "open" | "live" | "signupsSoon" | "none" | "cancelled";

export function nextGamePhase(i: { now: number; startMs: number; durationMinutes: number; weekly: boolean; cancelled: boolean }): NextGamePhase {
  if (i.cancelled) return "cancelled";
  const endMs = i.startMs + i.durationMinutes * MINUTE;
  if (i.now >= endMs) return i.weekly ? "signupsSoon" : "none";
  return i.now >= i.startMs ? "live" : "open";
}

export interface Countdown { hours: number; minutes: number }

/** Time to kickoff as "3 h 12 min", or null when it is a day or more away or has begun. A part-minute rounds up. */
export function countdownOf(msUntilStart: number): Countdown | null {
  if (msUntilStart <= 0 || msUntilStart >= COUNTDOWN_WINDOW_MS) return null;
  const total = Math.ceil(msUntilStart / MINUTE);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/**
 * How long to sleep until the next moment the block can change by the clock alone, or
 * null when nothing can. One timeout to the next boundary — not a ticker: far from the
 * game it sleeps until the countdown opens, then until the minute label flips.
 */
export function nextTickDelay(now: number, startMs: number, endMs: number): number | null {
  let delay: number;
  if (now < startMs - COUNTDOWN_WINDOW_MS) delay = startMs - COUNTDOWN_WINDOW_MS - now;
  else if (now < startMs) {
    const left = startMs - now;
    delay = left % MINUTE || MINUTE;
  } else if (now < endMs) delay = endMs - now;
  else return null;
  return Math.min(delay + SLACK_MS, MAX_TIMEOUT);
}

const dayKey = (ms: number, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

/** The game is today, on the calendar of the place where it is played. */
export function isGameDay(now: number, startMs: number, timezone: string): boolean {
  return dayKey(now, timezone) === dayKey(startMs, timezone);
}

/** Letters for a lineup slot: first and last word, or two letters of a single word. Emoji stay whole. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = (w: string) => Array.from(w);
  const pick = words.length === 1
    ? letters(words[0]).slice(0, 2).join("")
    : letters(words[0])[0] + letters(words[words.length - 1])[0];
  return pick.toUpperCase();
}

/** "Ana M." for each name — whole words only. Names that would collide stay in full. */
export function shortNames(names: readonly string[]): string[] {
  const short = names.map((full) => {
    const words = full.trim().split(/\s+/).filter(Boolean);
    return words.length < 2 ? full.trim() : `${words[0]} ${Array.from(words[words.length - 1])[0].toUpperCase()}.`;
  });
  const seen = new Map<string, number>();
  for (const s of short) seen.set(s.toLowerCase(), (seen.get(s.toLowerCase()) ?? 0) + 1);
  return short.map((s, i) => ((seen.get(s.toLowerCase()) ?? 0) > 1 ? names[i].trim() : s));
}

/** Smallest slot, in px: big for a small game (up to 56 on a roomy screen), 36 for a full pitch of 16 or more. */
export function slotMinSize(maxPlayers: number): number {
  return maxPlayers <= 8 ? 52 : 36;
}

/** Slots no bigger than this, so a wide screen does not blow them up. */
export const SLOT_MAX_SIZE = 56;
export const SLOT_GAP = 8;

/**
 * How many slots a row aims for: a small game splits into even rows (6 → 3 + 3, 8 → 4 + 4),
 * a pitch of 9 or more fills rows of 8. A narrow screen may fit fewer and wraps to more rows.
 */
export function slotColumns(maxPlayers: number): number {
  if (maxPlayers <= 4) return Math.max(1, maxPlayers);
  return maxPlayers <= 8 ? Math.ceil(maxPlayers / 2) : 8;
}

export type RsvpView =
  | { kind: "signIn" }
  | { kind: "choose"; full: boolean }
  | { kind: "in"; team: string | null }
  | { kind: "bench"; position: number }
  | { kind: "out" };

/**
 * What the RSVP row says. The viewer is matched through the linked account only: an
 * unlinked row that merely shares their name is not them (name match is removal-only, #1331).
 */
export function rsvpView<P extends { userId?: string | null }>(i: {
  viewerId: string | null;
  players: readonly P[];
  maxPlayers: number;
  rsvp: "yes" | "no" | "maybe" | null;
  /** The viewer's team once teams are drawn. */
  teamName: string | null;
}): RsvpView {
  if (!i.viewerId) return { kind: "signIn" };
  const index = i.players.findIndex((p) => p.userId === i.viewerId);
  if (index >= 0) return index >= i.maxPlayers ? { kind: "bench", position: index - i.maxPlayers + 1 } : { kind: "in", team: i.teamName };
  if (i.rsvp === "no") return { kind: "out" };
  return { kind: "choose", full: i.players.length >= i.maxPlayers };
}

export function waitingCounts(invited: number, declined: number) {
  return { invited, declined, any: invited + declined > 0 };
}

/** The bench in one line: up to three short names, and how many more. */
export function benchLabelNames(names: readonly string[]): { names: string[]; more: number } {
  const shown = shortNames(names.slice(0, 3));
  return { names: shown, more: Math.max(0, names.length - 3) };
}

/**
 * Whether the viewer may be offered "Undo" after removing someone. The undo route takes the
 * organizer only (owner, admin, or the open ownerless event), while the remove route also lets
 * a player take themselves off and anyone take off an anonymous row — those would get a 403.
 */
export function canUndoRemoval(perms: { isOwner: boolean; isAdmin: boolean; canEditSettings: boolean }): boolean {
  return perms.isOwner || perms.isAdmin || perms.canEditSettings;
}
