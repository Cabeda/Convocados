import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Stack } from "@mui/material";
import { useLocale } from "~/lib/useT";
import { formatDateInTz } from "~/lib/timezones";
import { formatMoneyCompact } from "~/lib/money";
import {
  isSetsScoringSport, nextRecapBoundary, pendingTaskCount, recapPhase, recapTasks, scoreSummary, type RecapRole,
} from "~/lib/eventStory";
import { RecurrencePrompt } from "../../RecurrencePrompt";
import { applyOptimistic, usePostGameStatus, type Optimistic, type PostGameStatus } from "./postGameStatus";
import { LastGameRecap } from "./LastGameRecap";
import { RecapReminder } from "./RecapReminder";
import { RecapSkeleton } from "./RecapSkeleton";
import { useSelfReport } from "./useSelfReport";

export interface EventRecapProps {
  eventId: string;
  initialStatus: PostGameStatus | null | undefined;
  viewerName: string | null;
  isAuthenticated: boolean;
  /** Owner or event admin. */
  canManage: boolean;
  isRecurring: boolean;
  /** The event's current kickoff (ISO). Counts as "next game" only once it is after the last game. */
  nextKickoff: string;
  timezone: string;
  sport?: string;
  /** `?action=` from the URL. */
  deepLinkAction: string | null;
}

const seenKey = (eventId: string, gameId: string) => `recap:seen:${eventId}:${gameId}`;
const shapeKey = (eventId: string) => `recap:shape:${eventId}`;
/** setTimeout cannot wait longer than this; a longer wait is simply taken in two steps. */
const MAX_TIMEOUT = 2_147_000_000;

const read = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
};

/**
 * The last game on top of the next game: decides how much recap to show
 * (full card, strip, game-day reminder or nothing) and wires its data.
 * Everything it decides lives in `src/lib/eventStory.ts`.
 */
export function EventRecap(p: EventRecapProps) {
  const { locale, t } = useLocale();
  const { status: serverStatus, loaded, refresh, setPaused } = usePostGameStatus(p.eventId, p.initialStatus);
  const [optimistic, setOptimistic] = useState<Optimistic>({});
  const [open, setOpen] = useState<boolean | null>(null);
  // The viewer finished something this visit: the card stays open (and says so) until they hide it.
  const [justCompleted, setJustCompleted] = useState(false);
  const [reminderReported, setReminderReported] = useState<string | null>(null);

  const status = useMemo(() => (serverStatus ? applyOptimistic(serverStatus, optimistic) : null), [serverStatus, optimistic]);
  const lastGame = status?.lastGameDateTime ?? null;
  const gameKey = status?.latestHistoryId ?? lastGame ?? "";
  // The page is client-only, so localStorage can be read while rendering: no first frame with the wrong shape.
  // Read once per game: the card stays open for the whole visit even after it is marked seen.
  const seen = useMemo(() => (gameKey ? !!read(seenKey(p.eventId, gameKey)) : true), [p.eventId, gameKey]);

  const role: RecapRole = !p.isAuthenticated ? "signedOut" : status?.isPlayer ? "played" : "absent";
  const tasks = useMemo(() => !status ? [] : recapTasks({
    role, canManage: p.canManage, hasLastGame: !!lastGame, latestHistoryId: status.latestHistoryId, hasScore: status.hasScore,
    hasCost: status.hasCost, mvpEnabled: status.mvpEnabled, myMvpComplete: status.myMvpComplete ?? true, viewerName: p.viewerName,
    viewerNames: status.viewerNames,
    viewerPaymentSettled: !!status.viewerPaymentSettled, gameMode: status.gameConfig?.mode ?? null,
    payerName: status.gameConfig?.payerName ?? null, payments: status.gamePayments, allPaid: status.allPaid,
    payerHasPaymentDetails: !!status.payerHasPaymentDetails,
    setsScoring: isSetsScoringSport(p.sport ?? ""),
  }), [status, role, p.canManage, p.viewerName, p.sport, lastGame]);
  const pending = pendingTaskCount(tasks);

  const next = new Date(p.nextKickoff);
  const nextKickoff = lastGame && next.getTime() > new Date(lastGame).getTime() ? next : null;
  const weekly = p.isRecurring;

  // Game day arrives while the page is open — but only that one moment changes the
  // phase, so there is one timeout for it instead of a ticker that re-renders every minute.
  const [now, setNow] = useState(() => Date.now());
  const boundary = nextRecapBoundary({ now, nextKickoff, hasLastGame: !!lastGame, weekly });
  useEffect(() => {
    if (boundary === null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(Math.max(boundary - Date.now(), 0) + 50, MAX_TIMEOUT));
    return () => clearTimeout(id);
  }, [boundary]);

  const payTask = tasks.find((x) => x.kind === "pay");
  const phase = recapPhase({
    now, nextKickoff, hasLastGame: !!lastGame, weekly, cancelled: false,
    role, taskCount: pending, seen, owesShare: !!payTask || !!reminderReported,
  });
  useEffect(() => { setPaused(phase === "hidden"); }, [phase, setPaused]);

  const onOptimistic = useCallback((patch: Optimistic) => setOptimistic((o) => ({ ...o, ...patch })), []);
  const onRollback = useCallback((key: keyof Optimistic) => setOptimistic((o) => { const { [key]: _gone, ...rest } = o; return rest; }), []);
  const reminderReport = useSelfReport(p.eventId, status, { onOptimistic, onRollback });

  const expanded = pending > 0 || justCompleted || (open ?? phase === "full");
  const showing = !!status && (phase === "full" || phase === "strip");
  useEffect(() => {
    if (showing && phase === "full" && gameKey) write(seenKey(p.eventId, gameKey), "1");
    if (showing && gameKey) write(shapeKey(p.eventId), phase);
  }, [showing, phase, gameKey, p.eventId]);

  const onToggle = () => {
    if (expanded) { setOpen(false); setJustCompleted(false); } else setOpen(true);
  };

  // Not known yet: hold the card's place so the page below does not jump when it arrives.
  const expectRecap = p.isRecurring || new Date(p.nextKickoff).getTime() < now;
  if (!loaded && !status) {
    return expectRecap ? <RecapSkeleton strip={read(shapeKey(p.eventId)) === "strip"} /> : null;
  }
  if (!status || !lastGame) return null;
  if (phase === "hidden" || (phase === "reminder" && payTask?.kind !== "pay" && !reminderReported)) return null;

  const result = {
    hasScore: status.hasScore, scoreOne: status.scoreOne, scoreTwo: status.scoreTwo,
    teamOneName: status.teamOneName, teamTwoName: status.teamTwoName, viewerTeam: status.viewerTeam ?? null,
  };
  const summary = scoreSummary({ ...result, seasonDelta: status.seasonRank?.counted ? status.seasonRank.delta : null }, t);
  const outcome = scoreSummary({ ...result, seasonDelta: null }, t);
  const dateLabel = formatDateInTz(new Date(lastGame), locale, p.timezone, { weekday: "short", day: "numeric", month: "short" });
  // Only an event that does not repeat yet asks "make it weekly?", and only of someone who can say yes.
  const offerWeekly = p.canManage && phase === "full" && !p.isRecurring && !status.isRecurring && status.allComplete;

  return (
    <Stack spacing={1.5}>
      {phase === "reminder" && (payTask?.kind === "pay" || reminderReported) && (
        <RecapReminder
          eventId={p.eventId} currency={status.costCurrency} highlight={p.deepLinkAction === "pay"}
          task={payTask?.kind === "pay" ? payTask : null}
          failed={reminderReport.failed} reported={reminderReported}
          onPay={() => {
            if (payTask?.kind !== "pay") return;
            const text = t("recapPayReported", { amount: formatMoneyCompact(payTask.amount, status.costCurrency, locale), payer: payTask.payerName });
            void reminderReport.report(payTask.eventPlayerId, {
              applied: () => setReminderReported(text), reverted: () => setReminderReported(null),
            }).then((ok) => { if (ok) refresh(); });
          }}
        />
      )}
      {(phase === "full" || phase === "strip") && (
        <LastGameRecap
          eventId={p.eventId} status={status} expanded={expanded} canCollapse={pending === 0}
          onToggle={onToggle} dateLabel={dateLabel} role={role} viewerName={p.viewerName} viewerNames={status.viewerNames}
          tasks={tasks} summary={summary} outcome={outcome} onChanged={refresh}
          onOptimistic={onOptimistic} onRollback={onRollback} onCompleted={() => setJustCompleted(true)}
          autoOpenScore={p.deepLinkAction === "add-score"} highlightPay={p.deepLinkAction === "pay"}
        />
      )}
      {offerWeekly && (
        <Box><RecurrencePrompt eventId={p.eventId} isRecurring={false} complete flat /></Box>
      )}
    </Stack>
  );
}
