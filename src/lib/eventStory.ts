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
  /**
   * The score is missing and this viewer may add it (they played, or they own or administer the event).
   * Game day must not bury an unfinished score entry, so it keeps a minimal reminder.
   */
  addScorePending?: boolean;
}

export function recapPhase(input: RecapPhaseInput): RecapPhase {
  const { hasLastGame, cancelled, weekly, nextKickoff, role, taskCount, seen, owesShare, addScorePending } = input;
  if (!hasLastGame || cancelled) return "hidden";

  const now = typeof input.now === "number" ? input.now : input.now.getTime();
  // A one-off never hides the recap: there is no next game to make room for.
  if (weekly && nextKickoff && now >= nextKickoff.getTime() - RECAP_HIDE_BEFORE_KICKOFF_MS) {
    // The MVP vote and the money fold into one small reminder, but a missing score never disappears:
    // nobody else can say how the game ended once the page is about the next one.
    return owesShare || addScorePending ? "reminder" : "hidden";
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
  /** Roster names linked to the viewer's account (the account name often differs from the roster name). */
  viewerNames?: readonly string[];
  viewerPaymentSettled: boolean;
  gameMode: "tracked" | "untracked" | null;
  payerName: string | null;
  payments: readonly RecapPayment[] | null;
  allPaid: boolean;
  /** The collector has somewhere to send money to (drives the "How to pay" link). */
  payerHasPaymentDetails?: boolean;
  /** Tennis and padel are scored in sets, which the History page owns. */
  setsScoring?: boolean;
}

/** Sports whose result is a list of sets, not one number per team. */
/**
 * Is there a last game to recap? True when the newest history row is a game that was played: a cancelled
 * one has no result, scoreboard or tasks (the same rule `computePostGameStatus` applies).
 * Known without signing in, so the page can hold the recap's place before anything is fetched.
 */
export const hasRecappableGame = (latestHistory: { status: string } | null | undefined): boolean =>
  !!latestHistory && latestHistory.status !== "cancelled";

export const isSetsScoringSport = (sport: string) =>
  ["tennis", "tennis-singles", "tennis-doubles", "padel"].includes(sport.toLowerCase());

/**
 * One thing on the recap. `needsYou` separates what the viewer must do (it gets
 * the amber dot and keeps the card open) from what is only information.
 */
export type RecapTask =
  | { kind: "addScore"; needsYou: boolean; /** False when no history row exists yet, so the score cannot be saved in place. */ inline: boolean }
  | { kind: "mvp"; needsYou: boolean }
  | { kind: "pay"; needsYou: boolean; amount: number; payerName: string; eventPlayerId: string; /** The collector has details to show, so "How to pay" makes sense. */ hasPaymentDetails: boolean }
  | { kind: "nopayer"; needsYou: boolean; amount: number; canChoose: boolean }
  /** The viewer is the one collecting: a count of who paid, and a nudge only when someone says they sent it. */
  | { kind: "collect"; needsYou: boolean; paidCount: number; totalCount: number; sentCount: number };

/**
 * Where the `?action=add-score` deep link lands: the steppers on the recap (`inline`), or the History
 * page (`history`) for a game that cannot be scored in place (sets-scored sports, no history row yet).
 * Null when there is nothing for this viewer to add, so the link has nothing to do.
 */
export function addScoreDeepLinkTarget(tasks: readonly RecapTask[]): "inline" | "history" | null {
  const task = tasks.find((x) => x.kind === "addScore");
  if (!task || task.kind !== "addScore") return null;
  return task.inline ? "inline" : "history";
}

/** How many rows really need the viewer (informational rows do not count). */
export const pendingTaskCount = (tasks: readonly RecapTask[]) => tasks.filter((x) => x.needsYou).length;

/**
 * The next moment the clock alone changes the recap phase, or null when it can
 * never change that way (so the page needs no ticker at all).
 */
export function nextRecapBoundary(input: { now: Date | number; nextKickoff: Date | null; hasLastGame: boolean; weekly: boolean }): number | null {
  if (!input.hasLastGame || !input.weekly || !input.nextKickoff) return null;
  const now = typeof input.now === "number" ? input.now : input.now.getTime();
  const boundary = input.nextKickoff.getTime() - RECAP_HIDE_BEFORE_KICKOFF_MS;
  return boundary > now ? boundary : null;
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** What is left for this viewer, in the order it should be shown. */
export function recapTasks(input: RecapTasksInput): RecapTask[] {
  if (!input.hasLastGame) return [];
  const out: RecapTask[] = [];
  // The account name, then whatever roster names are linked to the account.
  const mine = [input.viewerName, ...(input.viewerNames ?? [])];
  const isViewer = (name: string | null | undefined) => mine.some((n) => same(n, name));

  // Anyone who played can add the score, and so can the owner and admins.
  if (!input.hasScore && (input.role === "played" || input.canManage)) {
    out.push({ kind: "addScore", needsYou: true, inline: !!input.latestHistoryId && !input.setsScoring });
  }

  // MVP is for players only, and only once there is a result to vote on.
  if (input.role === "played" && input.mvpEnabled && input.hasScore && input.latestHistoryId && !input.myMvpComplete) {
    out.push({ kind: "mvp", needsYou: true });
  }

  // Money is a task only when a cost exists and the game is tracked (otherwise
  // everyone pays their own share outside the app).
  const roll = input.payments ?? [];
  if (input.hasCost && input.gameMode === "tracked" && roll.length > 0) {
    const myRow = roll.find((r) => isViewer(r.name));
    // `sent` means the viewer already said they paid: that is done for them.
    const owes = !!myRow && !myRow.isPayer && myRow.status === "pending" && !input.viewerPaymentSettled;
    if (owes && myRow) {
      out.push(input.payerName
        ? { kind: "pay", needsYou: true, amount: myRow.amount, payerName: input.payerName, eventPlayerId: myRow.eventPlayerId, hasPaymentDetails: !!input.payerHasPaymentDetails }
        : { kind: "nopayer", needsYou: input.canManage, amount: myRow.amount, canChoose: input.canManage });
    }
    // Only the collector gets the row: for everyone else "who is collecting" is already said where they pay.
    if (isViewer(input.payerName) && !input.allPaid) {
      const s = summarizePayments(roll);
      const sentCount = roll.filter((r) => r.status === "sent").length;
      out.push({ kind: "collect", needsYou: sentCount > 0, paidCount: s.paidCount, totalCount: s.totalCount, sentCount });
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
  const points = Math.abs(seasonDelta) === 1 ? "recapPointsThisSeasonOne" : "recapPointsThisSeason";
  return `${outcome} \u00b7 ${t(points, { delta: signed })}`;
}
