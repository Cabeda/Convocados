import { describe, it, expect } from "vitest";
import {
  COUNTDOWN_WINDOW_MS, nextGamePhase, countdownOf, nextTickDelay, isGameDay, initials, shortNames,
  slotMinSize, slotColumns, slotLabels, phaseChangeDelay, nextGameHint, rsvpView, waitingCounts, benchLabelNames, canUndoRemoval, removeRule,
} from "~/lib/nextGame";

const MIN = 60_000;
const HOUR = 3_600_000;
const START = Date.UTC(2026, 11, 4, 20, 49); // Fri 4 Dec 2026, 20:49 UTC
const phaseOf = (now: number, o: Partial<{ weekly: boolean; cancelled: boolean; durationMinutes: number }> = {}) =>
  nextGamePhase({ now, startMs: START, durationMinutes: 90, weekly: true, cancelled: false, ...o });

describe("nextGamePhase", () => {
  it("is open before kickoff", () => expect(phaseOf(START - 3 * HOUR)).toBe("open"));
  it("is live from kickoff until the end, and the roster stays open", () => {
    expect(phaseOf(START)).toBe("live");
    expect(phaseOf(START + 89 * MIN)).toBe("live");
  });
  it("after the end a weekly game says sign-ups open in a moment (the roster is still the finished game's)", () => {
    expect(phaseOf(START + 90 * MIN)).toBe("signupsSoon");
    expect(phaseOf(START + 30 * HOUR)).toBe("signupsSoon");
  });
  it("after the end a one-off has no next game", () => expect(phaseOf(START + 2 * HOUR, { weekly: false })).toBe("none"));
  it("a cancelled game offers nothing, before or after", () => {
    expect(phaseOf(START - HOUR, { cancelled: true })).toBe("cancelled");
    expect(phaseOf(START + 5 * HOUR, { cancelled: true })).toBe("cancelled");
  });
});

describe("phaseChangeDelay — one timeout to the moment the phase changes", () => {
  const END = START + 90 * MIN;
  it("waits for kickoff before the game, then for the end, then never", () => {
    expect(phaseChangeDelay(START - 3 * HOUR, START, END)).toBe(3 * HOUR + 50);
    expect(phaseChangeDelay(START + MIN, START, END)).toBe(89 * MIN + 50);
    expect(phaseChangeDelay(END, START, END)).toBeNull();
  });
  it("is not the countdown's minute ticker: far from the game it sleeps the whole way", () => {
    expect(phaseChangeDelay(START - 20 * HOUR, START, END)).toBe(20 * HOUR + 50);
  });
  it("never asks for a timeout the browser would fire at once", () => {
    expect(phaseChangeDelay(START - 40 * 24 * HOUR, START, END)).toBeLessThanOrEqual(2_147_000_000);
  });
});

describe("nextGameHint — what the server tells the loading page about the next game", () => {
  const base = { dateTime: new Date(START).toISOString(), durationMinutes: 90, recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }), maxPlayers: 12, cancelled: false };
  it("says open, with the size of the lineup, before kickoff", () => {
    expect(nextGameHint(base, START - HOUR)).toEqual({ maxPlayers: 12, phase: "open" });
  });
  it("says there is no next game for a one-off that has ended, and signups soon for a weekly one", () => {
    expect(nextGameHint({ ...base, recurrenceRule: null }, START + 5 * HOUR).phase).toBe("none");
    expect(nextGameHint(base, START + 5 * HOUR).phase).toBe("signupsSoon");
  });
  it("says cancelled for a cancelled game", () => {
    expect(nextGameHint({ ...base, cancelled: true }, START - HOUR).phase).toBe("cancelled");
  });
});

describe("countdownOf", () => {
  it("is null a day or more ahead, and once it has started", () => {
    expect(countdownOf(COUNTDOWN_WINDOW_MS)).toBeNull();
    expect(countdownOf(3 * 24 * HOUR)).toBeNull();
    expect(countdownOf(0)).toBeNull();
    expect(countdownOf(-5)).toBeNull();
  });
  it("counts hours and minutes, rounding a part-minute up so it never reads 0 min early", () => {
    expect(countdownOf(3 * HOUR + 12 * MIN)).toEqual({ hours: 3, minutes: 12 });
    expect(countdownOf(3 * HOUR + 11 * MIN + 1)).toEqual({ hours: 3, minutes: 12 });
    expect(countdownOf(23 * HOUR + 59 * MIN + 59_000)).toEqual({ hours: 24, minutes: 0 });
  });
  it("drops the hours under an hour, and the minutes on the hour", () => {
    expect(countdownOf(42 * MIN)).toEqual({ hours: 0, minutes: 42 });
    expect(countdownOf(HOUR)).toEqual({ hours: 1, minutes: 0 });
    expect(countdownOf(1_000)).toEqual({ hours: 0, minutes: 1 });
  });
});

describe("nextTickDelay — one timeout to the next moment the block can change", () => {
  const end = START + 90 * MIN;
  it("sleeps until the countdown window opens when the game is more than a day away", () => {
    expect(nextTickDelay(START - 3 * 24 * HOUR, START, end)).toBe(2 * 24 * HOUR + 50);
  });
  it("then wakes when the minute label changes, not every 60 seconds", () => {
    // 3 h 12 min 30 s left: the label (ceil to minutes) flips in 30 s.
    expect(nextTickDelay(START - (3 * HOUR + 12 * MIN + 30_000), START, end)).toBe(30_000 + 50);
    // exactly on a minute: a full minute until the next flip
    expect(nextTickDelay(START - (3 * HOUR + 12 * MIN), START, end)).toBe(MIN + 50);
  });
  it("in the last minute it wakes at kickoff, to show Live", () => {
    expect(nextTickDelay(START - 20_000, START, end)).toBe(20_000 + 50);
  });
  it("while live it wakes at the end", () => {
    expect(nextTickDelay(START + 10 * MIN, START, end)).toBe(80 * MIN + 50);
  });
  it("after the end nothing changes by the clock alone", () => {
    expect(nextTickDelay(end + 1, START, end)).toBeNull();
  });
  it("never asks for a timeout the browser would fire at once", () => {
    expect(nextTickDelay(START - 24 * HOUR - 5_000, START, end)).toBe(5_050);
  });
});

describe("isGameDay", () => {
  it("is true on the calendar day of the game in the EVENT's timezone", () => {
    expect(isGameDay(START - 5 * HOUR, START, "UTC")).toBe(true);
    expect(isGameDay(START - 30 * HOUR, START, "UTC")).toBe(false);
  });
  it("uses the event timezone, not the viewer's", () => {
    // 16:00 UTC on the 3rd is 01:00 on the 4th in Tokyo (+9).
    const now = Date.UTC(2026, 11, 3, 16, 0); // 01:00 on the 4th in Tokyo
    expect(isGameDay(now, Date.UTC(2026, 11, 4, 11, 0), "Asia/Tokyo")).toBe(true);
    expect(isGameDay(now, Date.UTC(2026, 11, 4, 11, 0), "UTC")).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first letters of the first and last word", () => {
    expect(initials("Ana Maria Silva")).toBe("AS");
    expect(initials("rui costa")).toBe("RC");
  });
  it("takes two letters of a single word", () => expect(initials("Beto")).toBe("BE"));
  it("copes with accents, stray spaces and nothing at all", () => {
    expect(initials("  Éva   ")).toBe("ÉV");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
  it("ignores text in brackets: a note is not part of the name", () => {
    expect(initials("Ana (convidada)")).toBe("AN");
    expect(initials("João (GR)")).toBe("JO");
    expect(initials("(GR)")).toBe("?");
  });
  it("skips suffixes such as Jr., IV and MD", () => {
    expect(initials("João Silva Jr.")).toBe("JS");
    expect(initials("Rui Costa IV")).toBe("RC");
    expect(initials("Maria Souza MD")).toBe("MS");
    expect(initials("Jr")).toBe("JR");
  });
  it("shows a plus-one as a plus and the letter of who brought them", () => {
    expect(initials("+1 do Rui")).toBe("+R");
    expect(initials("+1 de Ana")).toBe("+A");
    expect(initials("+2 of Sam")).toBe("+S");
    expect(initials("+1")).toBe("+1");
  });
  it("drops leading marks that are not letters", () => {
    expect(initials("~ Ana Costa")).toBe("AC");
    expect(initials("*Beto")).toBe("BE");
  });
  it("keeps an emoji whole, even one built from several (family, flags, skin tones)", () => {
    expect(initials("😀 Joe")).toBe("😀J");
    expect(initials("👨‍👩‍👧 Família")).toBe("👨‍👩‍👧F");
    expect(initials("👍🏽")).toBe("👍🏽");
    expect(initials("🇵🇹 Rui")).toBe("🇵🇹R");
  });
  it("takes a letter from each part of a hyphenated single name", () => {
    expect(initials("Jean-Luc")).toBe("JL");
    expect(initials("Ana-Maria Silva")).toBe("AS");
  });
  it("takes the first two characters of a name written without spaces", () => {
    expect(initials("山田太郎")).toBe("山田");
    expect(initials("김민준")).toBe("김민");
  });
});

describe("slotLabels — two people never show the same letters", () => {
  it("is the plain initials when nobody collides", () => {
    expect(slotLabels(["Ana Maria", "Beto Santos"])).toEqual({ labels: ["AM", "BS"], collides: false });
  });
  it("adds a letter to each of two people who would both be JW", () => {
    expect(slotLabels(["Joana Weiss", "Jack Weiss", "Rui Costa"])).toEqual({ labels: ["JoW", "JaW", "RC"], collides: true });
  });
  it("tells two single names apart", () => {
    expect(slotLabels(["Beto", "Bernardo"])).toEqual({ labels: ["Bet", "Ber"], collides: true });
  });
  it("keeps adding letters until the people differ", () => {
    expect(slotLabels(["Joana Weiss", "Joanna Weiss"]).labels).toEqual(["JoanaW", "JoannW"]);
  });
  it("leaves identical names alone: nothing more can be told apart", () => {
    expect(slotLabels(["Ana Maria", "ana maria"]).labels).toEqual(["AM", "AM"]);
  });
});

describe("shortNames — never cut mid-word, never ambiguous", () => {
  it("shortens to first name and last initial", () => {
    expect(shortNames(["Ana Maria", "Beto Santos"])).toEqual(["Ana M.", "Beto S."]);
  });
  it("keeps a single name whole", () => expect(shortNames(["Beto"])).toEqual(["Beto"]));
  it("keeps full names when the short forms would collide", () => {
    expect(shortNames(["Ana Maria", "Ana Moreira", "Rui Costa"])).toEqual(["Ana Maria", "Ana Moreira", "Rui C."]);
  });
});

describe("slotMinSize", () => {
  it("makes slots big for a small game and never under 36px for a big one", () => {
    expect(slotMinSize(4)).toBeGreaterThanOrEqual(48);
    expect(slotMinSize(8)).toBeGreaterThanOrEqual(48);
    expect(slotMinSize(16)).toBe(36);
    expect(slotMinSize(22)).toBeGreaterThanOrEqual(36);
    expect(slotMinSize(40)).toBeGreaterThanOrEqual(36);
  });
});

describe("slotColumns", () => {
  it("balances the rows: 10 → 5+5, 12 → 6+6, 16 → 8+8, 22 → 8+7+7", () => {
    expect(slotColumns(10)).toBe(5);
    expect(slotColumns(12)).toBe(6);
    expect(slotColumns(16)).toBe(8);
    expect(slotColumns(22)).toBe(8);
  });
  it("keeps a small game in big slots: 4 in one row, 6 as 3+3, 8 as 4+4", () => {
    expect([1, 2, 3, 4].map(slotColumns)).toEqual([1, 2, 3, 4]);
    expect([5, 6, 7, 8].map(slotColumns)).toEqual([3, 3, 4, 4]);
  });
  it("never asks for zero columns", () => expect(slotColumns(0)).toBe(1));
  it("fills every row it asks for, from 2 to 30 players", () => {
    for (let n = 2; n <= 30; n++) {
      const cols = slotColumns(n);
      const rows = Math.ceil(n / cols);
      expect(cols * rows, `n=${n}`).toBeGreaterThanOrEqual(n);
      expect((rows - 1) * cols, `n=${n} has an empty last row`).toBeLessThan(n);
      expect(cols, `n=${n} too wide`).toBeLessThanOrEqual(8);
      // No more rows than the width allows: the rows are as few as the cap permits.
      expect(rows, `n=${n} more rows than needed`).toBe(Math.ceil(n / (n <= 8 ? 4 : 8)));
    }
  });
});

describe("rsvpView — one answer for what the RSVP row says", () => {
  const players = [
    { id: "a", name: "Ana", userId: "u-a" }, { id: "b", name: "Beto", userId: null },
    { id: "me", name: "Jose", userId: "u-me" }, { id: "d", name: "Dani", userId: null },
  ];
  const base = { viewerId: "u-me" as string | null, players, maxPlayers: 10, rsvp: null as "yes" | "no" | "maybe" | null, teamName: null as string | null };

  it("signed out → sign in", () => expect(rsvpView({ ...base, viewerId: null })).toEqual({ kind: "signIn" }));
  it("signed in, not on the list → choose, and says when it is full", () => {
    expect(rsvpView({ ...base, viewerId: "u-x" })).toEqual({ kind: "choose", full: false });
    expect(rsvpView({ ...base, viewerId: "u-x", maxPlayers: 4 })).toEqual({ kind: "choose", full: true });
  });
  it("on the list → in, with the team once teams exist", () => {
    expect(rsvpView(base)).toEqual({ kind: "in", team: null });
    expect(rsvpView({ ...base, teamName: "Ninjas" })).toEqual({ kind: "in", team: "Ninjas" });
  });
  it("past maxPlayers → bench, numbered from 1", () => {
    expect(rsvpView({ ...base, maxPlayers: 2 })).toEqual({ kind: "bench", position: 1 });
    expect(rsvpView({ ...base, maxPlayers: 1 })).toEqual({ kind: "bench", position: 2 });
  });
  it("a declined answer and no row → out", () => {
    expect(rsvpView({ ...base, viewerId: "u-x", rsvp: "no" })).toEqual({ kind: "out" });
  });
  it("being on the list wins over an old 'no'", () => {
    expect(rsvpView({ ...base, rsvp: "no" })).toEqual({ kind: "in", team: null });
  });
  it("matches the account, never a same-named row that belongs to someone else", () => {
    expect(rsvpView({ ...base, viewerId: "u-x", players: [{ id: "z", name: "Jose", userId: "u-other" }] })).toEqual({ kind: "choose", full: false });
  });
  it("an unlinked row that merely shares the viewer's name is not the viewer (name match is removal-only)", () => {
    expect(rsvpView({ ...base, viewerId: "u-x", players: [{ id: "z", name: "Jose", userId: null }] })).toEqual({ kind: "choose", full: false });
  });
});

describe("waitingCounts", () => {
  it("counts pending invites and declines, and hides itself when there are none", () => {
    expect(waitingCounts(2, 1)).toEqual({ invited: 2, declined: 1, any: true });
    expect(waitingCounts(0, 0).any).toBe(false);
  });
});

describe("benchLabelNames", () => {
  it("lists up to three short names and counts the rest", () => {
    expect(benchLabelNames(["Ana Maria", "Beto Santos"])).toEqual({ names: ["Ana M.", "Beto S."], more: 0 });
    expect(benchLabelNames(["A One", "B Two", "C Three", "D Four", "E Five"])).toEqual({ names: ["A O.", "B T.", "C T."], more: 2 });
  });
});

describe("canUndoRemoval — the server only takes an undo from the organizer", () => {
  it("is true for the owner, an admin, and the open ownerless event", () => {
    expect(canUndoRemoval({ isOwner: true, isAdmin: false, canEditSettings: true })).toBe(true);
    expect(canUndoRemoval({ isOwner: false, isAdmin: true, canEditSettings: true })).toBe(true);
    expect(canUndoRemoval({ isOwner: false, isAdmin: false, canEditSettings: true })).toBe(true);
  });
  it("is false for everyone else, who would get a 403 for the Undo they were offered", () => {
    expect(canUndoRemoval({ isOwner: false, isAdmin: false, canEditSettings: false })).toBe(false);
  });
});

describe("removeRule — who may take whom off the list, and how", () => {
  const anon = { userId: null };
  const linked = { userId: "u-b" };
  const rule = (o: Partial<{ viewerId: string | null; organizer: boolean; player: { userId: string | null }; addedHere: boolean }>) =>
    removeRule({ viewerId: null, organizer: false, player: anon, addedHere: false, ...o });

  it("an organizer takes an anonymous row off at once, and asks first before taking an account off", () => {
    expect(rule({ viewerId: "o", organizer: true })).toBe("direct");
    expect(rule({ viewerId: "o", organizer: true, player: linked })).toBe("confirmAccount");
  });
  it("a row without an account that carries the viewer's own name is their slot too", () => {
    expect(removeRule({ viewerId: "u-1", organizer: false, player: anon, addedHere: false, nameMatch: true })).toBe("self");
  });
  it("a player's own slot is leaving, for everyone", () => {
    expect(rule({ viewerId: "u-b", player: linked })).toBe("self");
    expect(rule({ viewerId: "u-b", organizer: true, player: linked })).toBe("self");
  });
  it("a signed-in player may take an anonymous row off only after asking, and never somebody else's account", () => {
    expect(rule({ viewerId: "u-1" })).toBe("confirmGuest");
    expect(rule({ viewerId: "u-1", addedHere: true })).toBe("confirmGuest");
    expect(rule({ viewerId: "u-1", player: linked })).toBe("none");
  });
  it("a signed-out visitor may take off only the names this browser added", () => {
    expect(rule({ viewerId: null })).toBe("none");
    expect(rule({ viewerId: null, addedHere: true })).toBe("direct");
    expect(rule({ viewerId: null, player: linked, addedHere: true })).toBe("none");
  });
});
