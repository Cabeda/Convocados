import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Stack } from "@mui/material";
import { useLocale } from "~/lib/useT";
import { formatDateInTz } from "~/lib/timezones";
import {
  isSetsScoringSport, recapPhase, recapTasks, scoreSummary, type RecapRole,
} from "~/lib/eventStory";
import { RecurrencePrompt } from "../../RecurrencePrompt";
import { usePostGameStatus, type PostGameStatus } from "./postGameStatus";
import { LastGameRecap } from "./LastGameRecap";
import { RecapReminder } from "./RecapReminder";

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

/**
 * The last game on top of the next game: decides how much recap to show
 * (full card, strip, game-day reminder or nothing) and wires its data.
 * Everything it decides lives in `src/lib/eventStory.ts`.
 */
export function EventRecap(p: EventRecapProps) {
  const { locale, t } = useLocale();
  const { status, refresh } = usePostGameStatus(p.eventId, p.initialStatus);
  const [mounted, setMounted] = useState(false);
  // Read once: the card stays open for the whole visit even after it is marked seen.
  const [seen, setSeen] = useState(true);
  const [open, setOpen] = useState<boolean | null>(null);
  // Game day arrives while the page is open, so the clock ticks once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);

  const lastGame = status?.lastGameDateTime ?? null;
  const gameKey = status?.latestHistoryId ?? lastGame ?? "";

  /* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- localStorage is client-only: read after mount so SSR and hydration agree. */
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!gameKey) return;
    try {
      setSeen(!!localStorage.getItem(seenKey(p.eventId, gameKey)));
    } catch { setSeen(true); }
  }, [p.eventId, gameKey]);
  /* eslint-enable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect */

  const role: RecapRole = !p.isAuthenticated ? "signedOut" : status?.isPlayer ? "played" : "absent";
  const tasks = useMemo(() => !status ? [] : recapTasks({
    role, canManage: p.canManage, hasLastGame: !!lastGame, latestHistoryId: status.latestHistoryId, hasScore: status.hasScore,
    hasCost: status.hasCost, mvpEnabled: status.mvpEnabled, myMvpComplete: status.myMvpComplete ?? true, viewerName: p.viewerName,
    viewerPaymentSettled: !!status.viewerPaymentSettled, gameMode: status.gameConfig?.mode ?? null,
    payerName: status.gameConfig?.payerName ?? null, payments: status.gamePayments, allPaid: status.allPaid,
    setsScoring: isSetsScoringSport(p.sport ?? ""),
  }), [status, role, p.canManage, p.viewerName, p.sport, lastGame]);

  const next = new Date(p.nextKickoff);
  const nextKickoff = lastGame && next.getTime() > new Date(lastGame).getTime() ? next : null;
  const payTask = tasks.find((x) => x.kind === "pay");
  const phase = recapPhase({
    now, nextKickoff, hasLastGame: !!lastGame, weekly: p.isRecurring, cancelled: false,
    role, taskCount: tasks.length, seen, owesShare: !!payTask,
  });

  const expanded = tasks.length > 0 || (open ?? phase === "full");
  const showing = mounted && !!status && (phase === "full" || phase === "strip");
  useEffect(() => {
    if (showing && phase === "full" && gameKey) {
      try { localStorage.setItem(seenKey(p.eventId, gameKey), "1"); } catch { /* private mode */ }
    }
  }, [showing, phase, gameKey, p.eventId]);

  const wantsFocus = p.deepLinkAction === "add-score" || p.deepLinkAction === "pay";
  useEffect(() => {
    if (!showing || !wantsFocus || scrolledRef.current) return;
    scrolledRef.current = true;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.scrollIntoView?.({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, [showing, wantsFocus]);

  if (!mounted || !status || !lastGame) return null;
  if (phase === "hidden" || (phase === "reminder" && payTask?.kind !== "pay")) return null;

  const summary = scoreSummary({
    hasScore: status.hasScore, scoreOne: status.scoreOne, scoreTwo: status.scoreTwo,
    teamOneName: status.teamOneName, teamTwoName: status.teamTwoName,
    viewerTeam: status.viewerTeam ?? null, seasonDelta: status.seasonRank?.counted ? status.seasonRank.delta : null,
  }, t);
  const dateLabel = formatDateInTz(new Date(lastGame), locale, p.timezone, { weekday: "short", day: "numeric", month: "short" });

  return (
    <Stack spacing={1.5} ref={rootRef}>
      {phase === "reminder" && payTask?.kind === "pay" && (
        <RecapReminder eventId={p.eventId} status={status} task={payTask} onChanged={refresh} />
      )}
      {(phase === "full" || phase === "strip") && (
        <LastGameRecap
          eventId={p.eventId} status={status} expanded={expanded} canCollapse={tasks.length === 0}
          onToggle={() => setOpen(!expanded)} dateLabel={dateLabel} role={role} viewerName={p.viewerName}
          tasks={tasks} summary={summary} onChanged={refresh}
          autoOpenScore={p.deepLinkAction === "add-score"} highlightPay={p.deepLinkAction === "pay"}
        />
      )}
      {p.canManage && phase === "full" && (
        <Box><RecurrencePrompt eventId={p.eventId} isRecurring={!!status.isRecurring} complete={status.allComplete} /></Box>
      )}
    </Stack>
  );
}
