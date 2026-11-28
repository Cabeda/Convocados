/**
 * "One page, one story" — pure view logic for the last-game recap on the event
 * page. No React, no I/O: every rule here is unit-tested in
 * `src/test/eventStory.test.ts`, and the components only render what it says.
 */
import type { TFunction } from "./i18n";
import { summarizePayments } from "./paymentSummary";

/** On game day (this long before the next kickoff) a weekly event drops the recap. */
export const RECAP_HIDE_BEFORE_KICKOFF_MS = 6 * 3_600_000;

/** How the viewer relates to the last game. */
export type RecapRole = "played" | "benched" | "absent" | "signedOut";

/** How much recap to show: the full card, a one-line strip, nothing, or a small "you still owe" row. */
export type RecapPhase = "full" | "strip" | "hidden" | "reminder";

export interface RecapPhaseInput {
  now: Date | number;
  /** Next kickoff, or null when there is none yet (one-off, or not reset yet). */
  nextKickoff: Date | null;
  hasLastGame: boolean;
  weekly: boolean;
  cancelled: boolean;
  role: RecapRole;
  /** How many things are left for THIS viewer (see `recapTasks`). */
  taskCount: number;
  /** The viewer has already opened the full recap for this game on this device. */
  seen: boolean;
  /** The viewer still owes their share (drives the game-day reminder row). */
  owesShare: boolean;
}

export function recapPhase(input: RecapPhaseInput): RecapPhase {
  const { hasLastGame, cancelled, weekly, nextKickoff, role, taskCount, seen, owesShare } = input;
  if (!hasLastGame || cancelled) return "hidden";

  const now = typeof input.now === "number" ? input.now : input.now.getTime();
  // A one-off never hides the recap: there is no next game to make room for.
  if (weekly && nextKickoff && now >= nextKickoff.getTime() - RECAP_HIDE_BEFORE_KICKOFF_MS) {
    return owesShare ? "reminder" : "hidden";
  }

  // Players and signed-out visitors see the full card until they have seen it
  // and have nothing left. Anyone else (an admin who did not play) gets it only
  // while they have something to do.
  const engaged = role === "played" || role === "signedOut";
  if (taskCount > 0 || (engaged && !seen)) return "full";
  return "strip";
}

export interface RecapPayment {
  eventPlayerId: string;
  name: string;
  amount: number;
  status: string;
  isPayer: boolean;
}

export interface RecapTasksInput {
  role: RecapRole;
  /** Owner or event admin. */
  canManage: boolean;
  hasLastGame: boolean;
  latestHistoryId: string | null;
  hasScore: boolean;
  hasCost: boolean;
  mvpEnabled: boolean;
  /** True once THIS viewer has voted, or has no MVP task. */
  myMvpComplete: boolean;
  viewerName: string | null;
  viewerPaymentSettled: boolean;
  gameMode: "tracked" | "untracked" | null;
  payerName: string | null;
  payments: readonly RecapPayment[] | null;
  allPaid: boolean;
  /** Tennis and padel are scored in sets, which the History page owns. */
  setsScoring?: boolean;
}

/** Sports whose result is a list of sets, not one number per team. */
export const isSetsScoringSport = (sport: string) =>
  ["tennis", "tennis-singles", "tennis-doubles", "padel"].includes(sport.toLowerCase());

export type RecapTask =
  | { kind: "addScore"; /** False when no history row exists yet, so the score cannot be saved in place. */ inline: boolean }
  | { kind: "mvp" }
  | { kind: "pay"; amount: number; payerName: string; eventPlayerId: string }
  | { kind: "nopayer"; amount: number; canChoose: boolean }
  | { kind: "collect"; /** The viewer is the one collecting (otherwise an admin watching, naming the collector). */ collector: string | null; paidCount: number; totalCount: number; paidAmount: number; totalAmount: number };

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** What is left for this viewer, in the order it should be shown. */
export function recapTasks(input: RecapTasksInput): RecapTask[] {
  if (!input.hasLastGame) return [];
  const out: RecapTask[] = [];

  // Anyone who played can add the score, and so can the owner and admins.
  if (!input.hasScore && (input.role === "played" || input.canManage)) {
    out.push({ kind: "addScore", inline: !!input.latestHistoryId && !input.setsScoring });
  }

  // MVP is for players only, and only once there is a result to vote on.
  if (input.role === "played" && input.mvpEnabled && input.hasScore && input.latestHistoryId && !input.myMvpComplete) {
    out.push({ kind: "mvp" });
  }

  // Money is a task only when a cost exists and the game is tracked (otherwise
  // everyone pays their own share outside the app).
  const roll = input.payments ?? [];
  if (input.hasCost && input.gameMode === "tracked" && roll.length > 0) {
    const mine = roll.find((r) => same(r.name, input.viewerName));
    // `sent` means the viewer already said they paid: that is done for them.
    const owes = !!mine && !mine.isPayer && mine.status === "pending" && !input.viewerPaymentSettled;
    if (owes && mine) {
      out.push(input.payerName
        ? { kind: "pay", amount: mine.amount, payerName: input.payerName, eventPlayerId: mine.eventPlayerId }
        : { kind: "nopayer", amount: mine.amount, canChoose: input.canManage });
    }
    const collecting = same(input.payerName, input.viewerName) || (input.canManage && !!input.payerName);
    if (collecting && !input.allPaid) {
      const s = summarizePayments(roll);
      out.push({
        kind: "collect", collector: same(input.payerName, input.viewerName) ? null : input.payerName,
        paidCount: s.paidCount, totalCount: s.totalCount,
        paidAmount: s.paidAmount, totalAmount: roll.reduce((sum, r) => sum + r.amount, 0),
      });
    }
  }
  return out;
}

export interface ScoreSummaryInput {
  hasScore: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teamOneName: string;
  teamTwoName: string;
  /** Which team the viewer played for (0 = score one), or null if they did not play. */
  viewerTeam: 0 | 1 | null;
  /** Season points this game moved for the viewer; null when it did not count. */
  seasonDelta: number | null;
}

const MINUS = "\u2212";

/** One plain sentence about the result — no ranking jargon. */
export function scoreSummary(input: ScoreSummaryInput, t: TFunction): string {
  const { scoreOne, scoreTwo, viewerTeam, seasonDelta } = input;
  if (!input.hasScore || scoreOne === null || scoreTwo === null) return t("recapScoreMissing");

  let outcome: string;
  if (scoreOne === scoreTwo) outcome = t("recapDraw");
  else {
    const winner: 0 | 1 = scoreOne > scoreTwo ? 0 : 1;
    if (viewerTeam === null) outcome = t("recapTeamWon", { team: winner === 0 ? input.teamOneName : input.teamTwoName });
    else outcome = viewerTeam === winner ? t("recapYouWon") : t("recapYouLost");
  }

  if (viewerTeam === null || seasonDelta === null || seasonDelta === 0) return outcome;
  const signed = `${seasonDelta > 0 ? "+" : MINUS}${Math.abs(seasonDelta)}`;
  return `${outcome} \u00b7 ${t("recapPointsThisSeason", { delta: signed })}`;
}
