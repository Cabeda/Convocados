import { describe, it, expect } from "vitest";
import { createT } from "~/lib/i18n";
import {
  recapPhase, recapTasks, scoreSummary, isSetsScoringSport, RECAP_HIDE_BEFORE_KICKOFF_MS,
  nextRecapBoundary, pendingTaskCount, hasRecappableGame,
  type RecapPhaseInput, type RecapTasksInput, type RecapPayment,
} from "~/lib/eventStory";

const t = createT("en");
const HOUR = 3_600_000;
const NOW = new Date("2026-03-04T12:00:00Z");
const farKickoff = new Date(NOW.getTime() + 72 * HOUR);

// ── recapPhase ───────────────────────────────────────────────────────────────
const phaseBase: RecapPhaseInput = {
  now: NOW, nextKickoff: farKickoff, hasLastGame: true, weekly: true, cancelled: false,
  role: "played", taskCount: 0, seen: true, owesShare: false,
};
const phase = (o: Partial<RecapPhaseInput> = {}) => recapPhase({ ...phaseBase, ...o });

describe("recapPhase", () => {
  it("is hidden when there is no last game", () => {
    expect(phase({ hasLastGame: false })).toBe("hidden");
  });

  it("is hidden when the last game was cancelled, even with tasks", () => {
    expect(phase({ cancelled: true, taskCount: 2, seen: false })).toBe("hidden");
  });

  it("shows the full card to a player with tasks left, even when seen", () => {
    expect(phase({ role: "played", taskCount: 1, seen: true })).toBe("full");
  });

  it("shows the full card once to a player with nothing left who has not seen it", () => {
    expect(phase({ role: "played", taskCount: 0, seen: false })).toBe("full");
  });

  it("collapses to the strip once a player has nothing left and has seen it", () => {
    expect(phase({ role: "played", taskCount: 0, seen: true })).toBe("strip");
  });

  it("shows the full card once to a signed-out viewer, then the strip", () => {
    expect(phase({ role: "signedOut", seen: false })).toBe("full");
    expect(phase({ role: "signedOut", seen: true })).toBe("strip");
  });

  it.each(["benched", "absent"] as const)("gives a %s viewer the strip, never the full card", (role) => {
    expect(phase({ role, taskCount: 0, seen: false })).toBe("strip");
  });

  it("gives an admin who did not play the full card while a task (add the score) is left", () => {
    expect(phase({ role: "absent", taskCount: 1, seen: true })).toBe("full");
  });

  it("is hidden for a weekly event within 6h of the next kickoff", () => {
    const kickoff = new Date(NOW.getTime() + RECAP_HIDE_BEFORE_KICKOFF_MS);
    expect(phase({ nextKickoff: kickoff })).toBe("hidden");
    expect(phase({ nextKickoff: new Date(NOW.getTime() + 2 * HOUR), taskCount: 2, seen: false })).toBe("hidden");
  });

  it("stays visible just outside the 6h window", () => {
    const kickoff = new Date(NOW.getTime() + RECAP_HIDE_BEFORE_KICKOFF_MS + 1);
    expect(phase({ nextKickoff: kickoff })).toBe("strip");
  });

  it("keeps a small reminder on game day for a viewer who still owes", () => {
    expect(phase({ nextKickoff: new Date(NOW.getTime() + HOUR), owesShare: true })).toBe("reminder");
  });

  it("is hidden (no reminder) on game day when the viewer owes nothing", () => {
    expect(phase({ nextKickoff: new Date(NOW.getTime() + HOUR), owesShare: false })).toBe("hidden");
  });

  it("is hidden on game day after kickoff has passed too", () => {
    expect(phase({ nextKickoff: new Date(NOW.getTime() - HOUR) })).toBe("hidden");
  });

  it("never hides a one-off event, however close its date", () => {
    expect(phase({ weekly: false, nextKickoff: new Date(NOW.getTime() + HOUR) })).toBe("strip");
    expect(phase({ weekly: false, nextKickoff: null, taskCount: 1 })).toBe("full");
  });

  it("does not hide a weekly event whose next kickoff is unknown (not reset yet)", () => {
    expect(phase({ nextKickoff: null })).toBe("strip");
  });

  it("accepts epoch milliseconds for now", () => {
    expect(phase({ now: NOW.getTime() })).toBe("strip");
  });
});

// ── recapTasks ───────────────────────────────────────────────────────────────
const row = (name: string, status: string, amount = 5, isPayer = false): RecapPayment => ({
  eventPlayerId: `ep-${name}`, name, amount, status, isPayer,
});
const roll = [row("Ana", "pending"), row("Rui", "paid"), row("Maria", "paid", 5, true)];

const tasksBase: RecapTasksInput = {
  role: "played", canManage: false, hasLastGame: true, latestHistoryId: "h1",
  hasScore: true, hasCost: true, mvpEnabled: true, myMvpComplete: false, viewerName: "Ana",
  viewerPaymentSettled: false, gameMode: "tracked", payerName: "Maria", payments: roll, allPaid: false,
};
const tasks = (o: Partial<RecapTasksInput> = {}) => recapTasks({ ...tasksBase, ...o });
const kinds = (o: Partial<RecapTasksInput> = {}) => tasks(o).map((x) => x.kind);

describe("recapTasks — player", () => {
  it("lists mvp then pay, in order, for a player who owes with the score in", () => {
    expect(kinds()).toEqual(["mvp", "pay"]);
  });

  it("carries the amount and the collector on the pay task", () => {
    expect(tasks()[1]).toEqual({ kind: "pay", needsYou: true, amount: 5, payerName: "Maria", eventPlayerId: "ep-Ana", hasPaymentDetails: false });
  });

  it("tells the pay task whether the collector has payment details to show", () => {
    expect(tasks({ payerHasPaymentDetails: true })[1]).toMatchObject({ kind: "pay", hasPaymentDetails: true });
  });

  it("puts add-score first when the score is missing, and no mvp (needs a score)", () => {
    expect(kinds({ hasScore: false })).toEqual(["addScore", "pay"]);
  });

  it("flags the add-score task as inline only when a history row exists", () => {
    expect(tasks({ hasScore: false })[0]).toEqual({ kind: "addScore", needsYou: true, inline: true });
    expect(tasks({ hasScore: false, latestHistoryId: null })[0]).toEqual({ kind: "addScore", needsYou: true, inline: false });
  });

  it("sends sets-scored sports (tennis, padel) to the History page instead of inline steppers", () => {
    expect(tasks({ hasScore: false, setsScoring: true })[0]).toEqual({ kind: "addScore", needsYou: true, inline: false });
    expect(isSetsScoringSport("Padel")).toBe(true);
    expect(isSetsScoringSport("football")).toBe(false);
  });

  it("drops the mvp task when MVP is turned off", () => {
    expect(kinds({ mvpEnabled: false })).toEqual(["pay"]);
  });

  it("drops the mvp task once the viewer has voted or voting closed", () => {
    expect(kinds({ myMvpComplete: true })).toEqual(["pay"]);
  });

  it("drops the mvp task without a history row to vote on", () => {
    expect(kinds({ latestHistoryId: null })).toEqual(["pay"]);
  });

  it("has no payment task when no cost exists", () => {
    expect(kinds({ hasCost: false, payments: null })).toEqual(["mvp"]);
  });

  it("hides the payment task when the viewer's own share is settled", () => {
    expect(kinds({ viewerPaymentSettled: true })).toEqual(["mvp"]);
  });

  it("treats a reported payment (sent) as done for the payer-to-be, not a task", () => {
    expect(kinds({ payments: [row("Ana", "sent"), row("Maria", "paid", 5, true)] })).toEqual(["mvp"]);
  });

  it("matches the viewer's row case-insensitively", () => {
    expect(kinds({ viewerName: "  ana " })).toEqual(["mvp", "pay"]);
  });

  it("has no payment task when each player pays their own share (untracked)", () => {
    expect(kinds({ gameMode: "untracked" })).toEqual(["mvp"]);
  });

  it("has no payment task when the viewer is not on the roll", () => {
    expect(kinds({ viewerName: "Zed" })).toEqual(["mvp"]);
  });

  it("asks the organiser to pick a collector when nobody is collecting", () => {
    expect(tasks({ payerName: null })[1]).toEqual({ kind: "nopayer", needsYou: false, amount: 5, canChoose: false });
  });

  it("collector sees a collect task with progress until everyone paid — counts only, no money sum", () => {
    const t1 = tasks({
      viewerName: "Maria", payerName: "Maria", myMvpComplete: true,
      payments: [row("Ana", "pending"), row("Rui", "paid"), row("Maria", "paid", 5, true)],
    });
    expect(t1).toEqual([{ kind: "collect", needsYou: false, paidCount: 2, totalCount: 3, sentCount: 0 }]);
  });

  it("asks the collector to act only when somebody says they paid", () => {
    const [collect] = tasks({
      viewerName: "Maria", payerName: "Maria", myMvpComplete: true,
      payments: [row("Ana", "sent"), row("Rui", "paid"), row("Maria", "paid", 5, true)],
    });
    expect(collect).toMatchObject({ kind: "collect", needsYou: true, sentCount: 1 });
  });

  it("does not repeat who is collecting to an admin who is only watching", () => {
    expect(kinds({ role: "absent", canManage: true, viewerName: "Boss", myMvpComplete: true })).toEqual([]);
  });

  it("matches the viewer through a linked roster name when the account name differs", () => {
    const linked = { viewerName: "anab99", viewerNames: ["anab99", "Ana"] };
    expect(tasks(linked)[1]).toMatchObject({ kind: "pay", eventPlayerId: "ep-Ana" });
    expect(kinds({ ...linked, payerName: "Ana", payments: [row("Ana", "pending", 5, true), row("Rui", "pending")], myMvpComplete: true }))
      .toEqual(["collect"]);
  });

  it("falls back to the account name when no linked name is known", () => {
    expect(kinds({ viewerNames: [] })).toEqual(["mvp", "pay"]);
    expect(kinds({ viewerNames: undefined })).toEqual(["mvp", "pay"]);
  });

  it("collector has nothing to do once everyone paid", () => {
    expect(kinds({
      viewerName: "Maria", payerName: "Maria", myMvpComplete: true, allPaid: true,
      payments: [row("Ana", "paid"), row("Maria", "paid", 5, true)],
    })).toEqual([]);
  });
});

describe("recapTasks — organiser, bench, absent, signed out", () => {
  it("lets an admin who did not play add the score, but not vote", () => {
    expect(kinds({ role: "absent", canManage: true, hasScore: false, viewerName: "Boss" })).toEqual(["addScore"]);
    expect(kinds({ role: "absent", canManage: true, hasScore: true, viewerName: "Boss" })).toEqual([]);
  });

  it("lets an admin who played choose the collector when nobody is", () => {
    expect(tasks({ canManage: true, payerName: null })[1]).toEqual({ kind: "nopayer", needsYou: true, amount: 5, canChoose: true });
  });

  it("gives a benched or absent non-admin viewer no tasks", () => {
    expect(kinds({ role: "benched", viewerName: "Bo" })).toEqual([]);
    expect(kinds({ role: "absent", viewerName: "Bo", hasScore: false })).toEqual([]);
  });

  it("gives a signed-out viewer no tasks at all", () => {
    expect(kinds({ role: "signedOut", viewerName: null, hasScore: false })).toEqual([]);
  });

  it("gives nobody tasks when there is no last game", () => {
    expect(kinds({ hasLastGame: false, hasScore: false })).toEqual([]);
  });
});

// ── scoreSummary ─────────────────────────────────────────────────────────────
const sum = (o: Partial<Parameters<typeof scoreSummary>[0]> = {}) => scoreSummary({
  hasScore: true, scoreOne: 5, scoreTwo: 3, teamOneName: "Shadow Foxes", teamTwoName: "Blue Lions",
  viewerTeam: 0, seasonDelta: 143, ...o,
}, t);

describe("scoreSummary", () => {
  it("says the viewer won with the season points", () => {
    expect(sum()).toBe("You won · +143 points this season");
  });

  it("says the viewer lost with a real minus sign", () => {
    expect(sum({ viewerTeam: 1, seasonDelta: -48 })).toBe("You lost · \u221248 points this season");
  });

  it("omits the points when the game did not count or nothing moved", () => {
    expect(sum({ seasonDelta: null })).toBe("You won");
    expect(sum({ seasonDelta: 0 })).toBe("You won");
  });

  it("names the winning team for someone who did not play", () => {
    expect(sum({ viewerTeam: null, seasonDelta: null })).toBe("Shadow Foxes won");
    expect(sum({ viewerTeam: null, scoreOne: 1, scoreTwo: 2 })).toBe("Blue Lions won");
  });

  it("says draw without points for the winner/loser wording", () => {
    expect(sum({ scoreOne: 2, scoreTwo: 2 })).toBe("It was a draw · +143 points this season");
    expect(sum({ scoreOne: 2, scoreTwo: 2, viewerTeam: null })).toBe("It was a draw");
  });

  it("says the score is missing", () => {
    expect(sum({ hasScore: false, scoreOne: null, scoreTwo: null })).toBe("Score not added yet");
  });

  it("treats a half-filled score as missing", () => {
    expect(sum({ scoreTwo: null })).toBe("Score not added yet");
  });

  it("says point, not points, for a single point", () => {
    expect(sum({ seasonDelta: 1 })).toBe("You won · +1 point this season");
    expect(sum({ viewerTeam: 1, seasonDelta: -1 })).toBe("You lost · \u22121 point this season");
  });

  it("uses no ranking jargon", () => {
    expect(sum()).not.toMatch(/RP|tier|crew|provisional|elo/i);
  });
});

describe("pendingTaskCount", () => {
  it("counts only the rows that need the viewer, not the informational ones", () => {
    expect(pendingTaskCount(tasks({ payerName: null }))).toBe(1); // mvp; "nobody is collecting" is information for a non-admin
    expect(pendingTaskCount(tasks({ payerName: null, canManage: true }))).toBe(2);
    expect(pendingTaskCount([])).toBe(0);
  });
});

describe("nextRecapBoundary", () => {
  const base = { now: NOW, nextKickoff: farKickoff, hasLastGame: true, weekly: true };

  it("is the moment the recap makes room for game day (6h before the next kickoff)", () => {
    expect(nextRecapBoundary(base)).toBe(farKickoff.getTime() - RECAP_HIDE_BEFORE_KICKOFF_MS);
  });

  it("is null once that moment has passed: nothing time-based can change any more", () => {
    expect(nextRecapBoundary({ ...base, nextKickoff: new Date(NOW.getTime() + 2 * HOUR) })).toBeNull();
  });

  it("is null when the phase can never change with the clock", () => {
    expect(nextRecapBoundary({ ...base, weekly: false })).toBeNull();
    expect(nextRecapBoundary({ ...base, nextKickoff: null })).toBeNull();
    expect(nextRecapBoundary({ ...base, hasLastGame: false })).toBeNull();
  });
});

describe("hasRecappableGame", () => {
  it("is true only when the newest history row is a game that was played", () => {
    expect(hasRecappableGame(null)).toBe(false);
    expect(hasRecappableGame(undefined)).toBe(false);
    expect(hasRecappableGame({ status: "played" })).toBe(true);
    expect(hasRecappableGame({ status: "cancelled" })).toBe(false);
  });
});
