import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useLocale } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";
import { formatMoneyCompact } from "~/lib/money";
import { pendingTaskCount, type RecapRole, type RecapTask } from "~/lib/eventStory";
import { SignInButton } from "../../SignInButton";
import type { Optimistic, PostGameStatus } from "./postGameStatus";
import { Scoreboard } from "./Scoreboard";
import { RecapTaskRow } from "./RecapTaskRow";
import { RecapLinks } from "./RecapLinks";
import { MvpPicker, type MvpCandidate } from "./MvpPicker";
import { AddScoreSteppers } from "./AddScoreSteppers";
import { useSelfReport } from "./useSelfReport";
import { useOptimisticAction } from "./useOptimisticAction";
import { useMvpResult } from "./useMvpResult";
import { EASE, focusRing, motion, tappable } from "./styles";

export interface LastGameRecapProps {
  eventId: string;
  status: PostGameStatus;
  /** Full card (true) or one-line strip (false) — the same card, animated between the two. */
  expanded: boolean;
  /** The viewer may fold the card away (nothing left for them to do). */
  canCollapse: boolean;
  onToggle: () => void;
  dateLabel: string;
  role: RecapRole;
  viewerName: string | null;
  viewerNames?: readonly string[];
  tasks: RecapTask[];
  /** The plain sentence from `scoreSummary`. */
  summary: string;
  /** The same sentence without the season points: all the one-line strip has room for. */
  outcome?: string;
  /** Re-read the status after something changed. */
  onChanged: () => void;
  /** The viewer did something: believe it before the server confirms it. */
  onOptimistic?: (patch: Optimistic) => void;
  /** The server refused: take that belief back. */
  onRollback?: (key: keyof Optimistic) => void;
  /** The viewer finished something this visit (the card stays open until they hide it). */
  onCompleted?: () => void;
  /** Open the score steppers straight away (the `?action=add-score` deep link). */
  autoOpenScore?: boolean;
  /** Scroll to the pay row and pulse it once (the `?action=pay` deep link). */
  highlightPay?: boolean;
}

type Panel = "score" | "mvp";
interface Restore { score?: [number, number]; pick?: string; error?: Panel }
interface DoneRow { kind: string; title: string }

const CALM = "@media (prefers-reduced-motion: reduce)";
const fadeIn = {
  animation: `recapFade 200ms ${EASE}`,
  "@keyframes recapFade": { from: { opacity: 0 }, to: { opacity: 1 } },
  [CALM]: { animation: "none" },
};

/**
 * The last game, as the ONE card on the event page. Expanded it is the full
 * recap (scoreboard, what is left for the viewer, three links); collapsed it
 * is a one-line strip. Height and opacity animate between the two while the
 * scoreboard stays the same element.
 */
export function LastGameRecap(p: LastGameRecapProps) {
  const { locale, t } = useLocale();
  const { eventId, status, expanded, tasks, role, onOptimistic, onRollback, onCompleted } = p;
  const [openPanel, setOpenPanel] = useState<Panel | null>(p.autoOpenScore ? "score" : null);
  const [restore, setRestore] = useState<Restore | null>(null);
  const [done, setDone] = useState<DoneRow[]>([]);
  const triggerElsRef = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});
  const returnFocusRef = useRef<Panel | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const scoreAction = useOptimisticAction();
  const voteAction = useOptimisticAction();

  const addDone = useCallback((row: DoneRow) => setDone((d) => [...d.filter((x) => x.kind !== row.kind), row]), []);
  const removeDone = useCallback((kind: string) => setDone((d) => d.filter((x) => x.kind !== kind)), []);
  const selfReport = useSelfReport(eventId, status, { onOptimistic, onRollback });

  const money = (amount: number) => formatMoneyCompact(amount, status.costCurrency, locale);
  const detailsId = `recap-details-${eventId}`;
  const scorePanelId = `recap-panel-score-${eventId}`;
  const mvpPanelId = `recap-panel-mvp-${eventId}`;
  const hasScore = status.scoreOne !== null && status.scoreTwo !== null;
  const historyId = status.latestHistoryId;
  const pending = pendingTaskCount(tasks);
  const allDoneNow = done.length > 0 && pending === 0;
  const scoreTask = tasks.find((x) => x.kind === "addScore");
  const scoreOpen = openPanel === "score" && !hasScore && !!scoreTask;

  // After something is finished the button that did it is gone: the live line is where focus goes.
  const doneCountRef = useRef(0);
  useEffect(() => {
    if (done.length > doneCountRef.current) statusRef.current?.focus();
    doneCountRef.current = done.length;
  }, [done.length]);

  // After Not now, focus goes back to the button that opened the panel.
  useEffect(() => {
    if (openPanel === null && returnFocusRef.current) {
      triggerElsRef.current[returnFocusRef.current]?.focus();
      returnFocusRef.current = null;
    }
  }, [openPanel]);

  const cancel = (panel: Panel) => { returnFocusRef.current = panel; setRestore(null); setOpenPanel(null); };
  const toggle = (panel: Panel) => (openPanel === panel ? cancel(panel) : (setRestore(null), setOpenPanel(panel)));

  const saveScore = (a: number, b: number) => {
    if (!historyId) return;
    void scoreAction.run({
      apply: () => { onOptimistic?.({ score: [a, b] }); setRestore(null); setOpenPanel(null); addDone({ kind: "score", title: t("recapScoreSaved") }); onCompleted?.(); },
      request: () => apiRequest("PATCH /api/events/{id}/history/{historyId}", { params: { id: eventId, historyId }, body: { scoreOne: a, scoreTwo: b } }),
      revert: () => { onRollback?.("score"); removeDone("score"); setRestore({ score: [a, b], error: "score" }); setOpenPanel("score"); },
    }).then((ok) => { if (ok) p.onChanged(); });
  };

  const vote = (who: MvpCandidate) => {
    if (!historyId) return;
    void voteAction.run({
      apply: () => { onOptimistic?.({ voted: true }); setRestore(null); setOpenPanel(null); addDone({ kind: "mvp", title: t("recapMvpDone", { name: who.name }) }); onCompleted?.(); },
      request: () => apiRequest("POST /api/events/{id}/history/{historyId}/mvp-vote", { params: { id: eventId, historyId }, body: { votedForPlayerId: who.id } }),
      revert: () => { onRollback?.("voted"); removeDone("mvp"); setRestore({ pick: who.id, error: "mvp" }); setOpenPanel("mvp"); },
    }).then((ok) => { if (ok) p.onChanged(); });
  };

  const pay = (task: Extract<RecapTask, { kind: "pay" }>) => {
    const title = t("recapPayReported", { amount: money(task.amount), payer: task.payerName });
    void selfReport.report(task.eventPlayerId, {
      applied: () => { addDone({ kind: "pay", title }); onCompleted?.(); },
      reverted: () => removeDone("pay"),
    }).then((ok) => { if (ok) p.onChanged(); });
  };

  const rows = tasks.map((task) => {
    const key = task.kind;
    switch (task.kind) {
      case "addScore":
        return task.inline && historyId ? (
          <RecapTaskRow
            key={key} needsYou={task.needsYou} title={t("recapAddScoreTitle")} sub={t("recapAddScoreSub")} action={t("recapAddScoreAction")}
            expanded={scoreOpen} panelId={scorePanelId} actionRef={(el) => { triggerElsRef.current.score = el; }} onAction={() => toggle("score")}
          />
        ) : (
          <RecapTaskRow key={key} needsYou={task.needsYou} title={t("recapAddScoreTitle")} sub={t("recapAddScoreSub")} action={t("recapAddScoreOpenHistory")} href={`/events/${eventId}/history`} />
        );
      case "mvp":
        return (
          <RecapTaskRow
            key={key} needsYou={task.needsYou} title={t("recapMvpTitle")} sub={t("recapMvpSub")} action={t("recapMvpAction")}
            expanded={openPanel === "mvp"} panelId={mvpPanelId} actionRef={(el) => { triggerElsRef.current.mvp = el; }} onAction={() => toggle("mvp")}
            panel={historyId ? (
              <MvpPicker
                eventId={eventId} historyId={historyId} panelId={mvpPanelId} selfName={p.viewerName} selfNames={p.viewerNames}
                initialPick={restore?.pick} startError={restore?.error === "mvp"} onVote={vote} onCancel={() => cancel("mvp")}
              />
            ) : null}
          />
        );
      case "pay":
        return (
          <RecapTaskRow
            key={key} needsYou={task.needsYou} highlight={p.highlightPay}
            title={t("recapPayTitle", { amount: money(task.amount) })} sub={t("recapPaySub", { payer: task.payerName })}
            secondary={task.hasPaymentDetails ? { label: t("recapHowToPay"), href: `/events/${eventId}/payments` } : undefined}
            action={t("recapPayAction")} onAction={() => pay(task)}
          >
            {selfReport.failed && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.9375rem", px: 2, pb: 1.5 }}>{t("recapPayError")}</Typography>}
          </RecapTaskRow>
        );
      case "nopayer":
        return (
          <RecapTaskRow
            key={key} needsYou={task.needsYou} title={t("recapNoPayerTitle", { amount: money(task.amount) })}
            sub={t(task.canChoose ? "recapNoPayerSubAdmin" : "recapNoPayerSub")}
            action={task.canChoose ? t("recapNoPayerAction") : undefined} href={`/events/${eventId}/payments`}
          />
        );
      case "collect":
        return (
          <RecapTaskRow
            key={key} needsYou={task.needsYou} title={t("recapCollectTitle")} href={`/events/${eventId}/payments`} action={t("recapCollectAction")}
            sub={task.sentCount > 0
              ? t("recapCollectSubSent", { paid: task.paidCount, count: task.totalCount, sent: task.sentCount })
              : t("recapCollectSub", { paid: task.paidCount, count: task.totalCount })}
          />
        );
    }
  });

  const showPayments = status.hasCost && role !== "signedOut";
  const winners = useMvpResult(eventId, historyId, expanded && status.mvpEnabled && hasScore);
  const lastGame = t("recapLastGame", { date: p.dateLabel });
  // One sentence about a missing score: the add-score row says it, so the summary stays quiet there.
  const showSummary = expanded && !scoreOpen && !(!hasScore && scoreTask);
  const showAllDoneRow = done.length === 0 && pending === 0 && role === "played" && hasScore;
  const headerText = expanded ? (allDoneNow ? t("recapAllDone") : lastGame) : `${lastGame} · ${p.outcome ?? p.summary}`;
  const rollOnChange = done.some((d) => d.kind === "score");

  return (
    <Box
      component="section" aria-labelledby="recap-heading" data-testid="last-game-recap"
      sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: "20px", overflow: "clip" }}
    >
      <Box
        data-testid="recap-scoreboard"
        onClick={expanded ? undefined : p.onToggle}
        sx={{
          px: 2, pt: expanded ? 1.5 : 1, pb: expanded ? 2.5 : 1, cursor: expanded ? "default" : "pointer",
          display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 1, alignItems: "center",
          gridTemplateAreas: expanded ? '"label toggle" "board board" "summary summary"' : '"board toggle" "label toggle"',
          ...motion("padding"),
        }}
      >
        <Typography
          id="recap-heading" component="h2" key={allDoneNow ? "done" : "label"} data-testid="recap-header-label"
          sx={{ gridArea: "label", fontSize: expanded ? "0.9375rem" : "0.8125rem", color: allDoneNow ? "primary.main" : "text.secondary", fontWeight: allDoneNow ? 700 : 400, minHeight: expanded ? 44 : undefined, display: "flex", alignItems: "center", ...(allDoneNow ? fadeIn : {}) }}
        >
          {headerText}
        </Typography>
        {(!expanded || p.canCollapse) && (
          <Button
            aria-expanded={expanded} aria-controls={detailsId} aria-label={t(expanded ? "recapHideAria" : "recapShowAria")}
            onClick={(e) => { e.stopPropagation(); p.onToggle(); }}
            endIcon={expanded ? <ExpandMoreIcon sx={{ transform: "rotate(180deg)" }} /> : undefined}
            sx={{ gridArea: "toggle", minHeight: 44, minWidth: 44, mr: -1, textTransform: "none", fontWeight: 700, fontSize: "0.9375rem", ...(expanded ? {} : { px: 0 }), ...tappable }}
          >
            {expanded ? t("recapHide") : <ExpandMoreIcon />}
          </Button>
        )}
        <Box sx={{ gridArea: "board", minWidth: 0 }}>
          {scoreOpen ? (
            <AddScoreSteppers
              panelId={scorePanelId} teamOneName={status.teamOneName} teamTwoName={status.teamTwoName}
              initial={restore?.score} startError={restore?.error === "score"} onSave={saveScore} onCancel={() => cancel("score")}
            />
          ) : (
            <Scoreboard teamOneName={status.teamOneName} teamTwoName={status.teamTwoName} scoreOne={status.scoreOne} scoreTwo={status.scoreTwo} compact={!expanded} rollOnChange={rollOnChange} />
          )}
        </Box>
        {showSummary && (
          <Box sx={{ gridArea: "summary", mt: 1 }}>
            <Typography role="status" sx={{ fontSize: "1.0625rem", fontWeight: 700, textWrap: "pretty" }}>{p.summary}</Typography>
            {winners && (
              <Box
                data-testid="recap-mvp-result" role="img" aria-label={t("recapMvpResultAria", { name: winners.join(", ") })}
                sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5, color: "text.secondary", fontSize: "0.9375rem" }}
              >
                <EmojiEventsIcon aria-hidden fontSize="small" sx={{ color: "attention.ring" }} />
                <span aria-hidden>{t("recapMvpResult", { name: winners.join(", ") })}</span>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box
        id={detailsId} aria-hidden={!expanded} inert={!expanded}
        sx={{ display: "grid", gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0, ...motion("grid-template-rows, opacity") }}
      >
        <Box sx={{ overflow: "clip", minHeight: 0 }}>
          {rows}
          <Box ref={statusRef} role="status" data-testid="recap-live" tabIndex={-1} sx={{ outline: "none", ...focusRing, "&:focus-visible": { outline: "none" } }}>
            {done.map((d) => <RecapTaskRow key={d.kind} done title={d.title} />)}
          </Box>
          {showAllDoneRow && <RecapTaskRow done title={t("recapAllDone")} />}
          {role === "signedOut" && (
            <RecapTaskRow testId="recap-signin" title={t("recapSignInRow")} needsYou={false}>
              <Box sx={{ px: 2, pb: 2 }}>
                <SignInButton callbackURL={typeof window === "undefined" ? "/" : window.location.pathname} variant="contained" disableElevation
                  sx={{ minHeight: 48, borderRadius: 999, px: 2.5, fontWeight: 700, textTransform: "none", ...tappable }}>
                  {t("signIn")}
                </SignInButton>
              </Box>
            </RecapTaskRow>
          )}
          <RecapLinks eventId={eventId} status={status} showPayments={showPayments} />
        </Box>
      </Box>
    </Box>
  );
}
