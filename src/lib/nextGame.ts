/**
 * "One page, one story" — pure view logic for the Next game block on the event
 * page. No React, no I/O: every rule here is unit-tested in
 * `src/test/nextGame.test.ts`, and the components only render what it says.
 */

import { parseRecurrenceRule } from "./recurrence";
import { normalizeForMatch } from "./stringMatch";

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

export interface NextGameHint { maxPlayers: number; phase: NextGamePhase }

/**
 * What the server tells the loading page about the next game, so it draws only what will be there:
 * how many places, and whether there is a lineup at all (a one-off that ended has none; a weekly one
 * between its end and its reset shows only the date; a cancelled one shows a list).
 */
export function nextGameHint(
  e: { dateTime: string | Date; durationMinutes: number; recurrenceRule: string | null; maxPlayers: number; cancelled: boolean },
  now: number,
): NextGameHint {
  const weekly = !!parseRecurrenceRule(e.recurrenceRule);
  return {
    maxPlayers: e.maxPlayers,
    phase: nextGamePhase({ now, startMs: new Date(e.dateTime).getTime(), durationMinutes: e.durationMinutes, weekly, cancelled: e.cancelled }),
  };
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

/**
 * How long until the PHASE can change by the clock alone — kickoff, then the end — or null when it cannot.
 * For the parts of the page that care about the phase only: they sleep through the countdown's minutes.
 */
export function phaseChangeDelay(now: number, startMs: number, endMs: number): number | null {
  const next = now < startMs ? startMs : now < endMs ? endMs : null;
  return next === null ? null : Math.min(next - now + SLACK_MS, MAX_TIMEOUT);
}

const dayKey = (ms: number, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

/** The game is today, on the calendar of the place where it is played. */
export function isGameDay(now: number, startMs: number, timezone: string): boolean {
  return dayKey(now, timezone) === dayKey(startMs, timezone);
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** What a person sees as one character: a letter with its accent, a family emoji, a flag, a thumb with a skin tone. */
function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

const SUFFIXES = /^(jr|sr|ii|iii|iv|md|phd)\.?$/i;
/** "+1 do Rui", "+2 of Sam": a guest, named after who brought them. */
const PLUS_ONE = /^\+\d+\s+(?:de|do|da|dos|das|del|di|of|von|van|d')\s*(.+)$/i;
const NOT_A_NAME_START = /^[^\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]+/u;

/** The words of a name as written, minus notes in brackets and suffixes like "Jr." — and the plus-one marker. */
function nameWords(name: string): { words: string[]; plus: boolean } {
  const bare = name.replace(/[(（][^)）]*[)）]/g, " ").trim();
  const guest = PLUS_ONE.exec(bare);
  const text = (guest ? guest[1] : bare).replace(NOT_A_NAME_START, "");
  const words = text.split(/\s+/).filter(Boolean);
  // A suffix is not a name — unless it is all there is.
  while (words.length > 1 && SUFFIXES.test(words[words.length - 1])) words.pop();
  return { words, plus: !!guest };
}

const cap = (g: string) => g.toUpperCase();

/**
 * Letters for a lineup slot: the first letter of the first and last word, or two letters of a
 * single word. A person is never cut in half: accents, flags and family emoji stay whole.
 * Notes in brackets and suffixes ("Jr.", "IV", "MD") are not read; "+1 do Rui" shows as "+R".
 */
export function initials(name: string): string {
  if (/^\+\d+$/.test(name.trim())) return name.trim();
  const { words, plus } = nameWords(name);
  if (words.length === 0) return "?";
  const first = graphemes(words[0]);
  let pick: string;
  if (plus) pick = "+" + cap(first[0]);
  else if (words.length > 1) pick = cap(first[0]) + cap(graphemes(words[words.length - 1])[0]);
  else {
    // One word: a hyphenated name gives a letter per part ("Jean-Luc" → JL); otherwise its first two characters.
    const parts = words[0].split("-").filter(Boolean);
    pick = parts.length > 1 ? cap(graphemes(parts[0])[0]) + cap(graphemes(parts[parts.length - 1])[0]) : cap(first.slice(0, 2).join(""));
  }
  return pick;
}

/** The longer form for two people who share initials: more of the first name, then the last initial ("JoW", "JaW"). */
function longInitials(name: string, k: number): string {
  const { words, plus } = nameWords(name);
  if (words.length === 0 || plus) return initials(name);
  const first = graphemes(words[0]);
  const head = cap(first[0]) + first.slice(1, k).join("").toLowerCase();
  if (words.length === 1) return cap(first[0]) + first.slice(1, k + 1).join("").toLowerCase();
  return head + cap(graphemes(words[words.length - 1])[0]);
}

/**
 * The letters for every slot. Where two people would show the same letters, those people get
 * more of their first name until they differ; `collides` says it happened, so the page can
 * open "Who's in" by itself — the letters alone no longer tell people apart.
 */
export function slotLabels(names: readonly string[]): { labels: string[]; collides: boolean } {
  const plain = names.map(initials);
  const shared = (label: string, list: readonly string[]) => list.filter((l) => l === label).length > 1;
  let pending = plain.map((_, i) => i).filter((i) => shared(plain[i], plain));
  if (pending.length === 0) return { labels: plain, collides: false };
  const labels = [...plain];
  for (let k = 2; k <= 8 && pending.length > 0; k++) {
    for (const i of pending) labels[i] = longInitials(names[i], k);
    pending = pending.filter((i) => shared(labels[i], labels));
  }
  // Still the same after every letter of the first name: they are the same person to the eye, so leave them.
  for (const i of pending) labels[i] = plain[i];
  return { labels, collides: true };
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
 * How many slots a row aims for, with the rows balanced: 10 → 5 + 5, 12 → 6 + 6, 16 → 8 + 8,
 * 22 → 8 + 7 + 7. A small game stays in big slots, at most 4 to a row (6 → 3 + 3, 8 → 4 + 4); a pitch of
 * 9 or more takes up to 8. A narrow screen may fit fewer and wraps to more rows.
 */
export function slotColumns(maxPlayers: number): number {
  if (maxPlayers <= 1) return 1;
  const rows = Math.ceil(maxPlayers / (maxPlayers <= 8 ? 4 : 8));
  return Math.ceil(maxPlayers / rows);
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

export type RemoveRule =
  /** The viewer's own slot: that is leaving, which has its own dialog. */
  | "self"
  /** Take off at once. */
  | "direct"
  /** An organizer removing someone with an account: ask first. */
  | "confirmAccount"
  /** A signed-in player removing a guest: ask first — "They will lose their place". */
  | "confirmGuest"
  /** Not theirs to remove. */
  | "none";

/**
 * Who may take whom off the list, and how. The server lets ANYONE take an anonymous row off — which would let a
 * passer-by empty the list — so the page narrows it: a signed-out visitor takes off only the names this browser
 * added; a signed-in player asks first; someone with an account is protected from everyone but themselves and
 * the organizer.
 */
export function removeRule(i: {
  viewerId: string | null; organizer: boolean; player: { userId?: string | null }; addedHere: boolean;
  /** The row has no account but carries the viewer's own name: removal only, never linked (#1331). */
  nameMatch?: boolean;
}): RemoveRule {
  if (i.viewerId && (i.player.userId === i.viewerId || (i.nameMatch && !i.player.userId))) return "self";
  if (i.organizer) return i.player.userId ? "confirmAccount" : "direct";
  if (i.player.userId) return "none";
  if (!i.viewerId) return i.addedHere ? "direct" : "none";
  return "confirmGuest";
}

/**
 * Who joined and who left between two readings of the list, for a polite announcement. People are told
 * apart by name (case and accents ignored); the viewer is never in it. Order does not matter.
 */
export function rosterChanges(
  prev: readonly { name: string; userId?: string | null }[],
  next: readonly { name: string; userId?: string | null }[],
  viewerId: string | null,
): { joined: string[]; left: string[] } {
  const others = (list: readonly { name: string; userId?: string | null }[]) => list.filter((p) => !viewerId || p.userId !== viewerId);
  const tally = (list: readonly { name: string }[]) => {
    const m = new Map<string, { name: string; n: number }>();
    for (const p of list) { const k = normalizeForMatch(p.name); const e = m.get(k); if (e) e.n += 1; else m.set(k, { name: p.name, n: 1 }); }
    return m;
  };
  const before = tally(others(prev));
  const after = tally(others(next));
  const diff = (from: typeof before, to: typeof before) => {
    const out: string[] = [];
    for (const [k, e] of to) for (let i = 0; i < e.n - (from.get(k)?.n ?? 0); i++) out.push(e.name);
    return out;
  };
  return { joined: diff(before, after), left: diff(after, before) };
}
