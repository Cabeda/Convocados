import { useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GroupsIcon from "@mui/icons-material/Groups";
import PaymentsIcon from "@mui/icons-material/Payments";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import { useT } from "~/lib/useT";
import { formatMoney, toCents } from "~/lib/money";
import { summarizePayments } from "~/lib/paymentSummary";
import type { RecapRole, RecapTask } from "~/lib/eventStory";
import { SignInButton } from "../../SignInButton";
import type { PostGameStatus } from "./postGameStatus";
import { Scoreboard, motion } from "./Scoreboard";
import { RecapTaskRow } from "./RecapTaskRow";
import { MvpPicker } from "./MvpPicker";
import { AddScoreSteppers } from "./AddScoreSteppers";
import { useSelfReport } from "./useSelfReport";

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
  tasks: RecapTask[];
  /** The plain sentence from `scoreSummary`. */
  summary: string;
  /** Re-read the status after something changed. */
  onChanged: () => void;
  /** Open the score steppers straight away (the `?action=add-score` deep link). */
  autoOpenScore?: boolean;
  /** Pulse the pay row once (the `?action=pay` deep link). */
  highlightPay?: boolean;
}

const cheer = () => { try { navigator.vibrate?.(10); } catch { /* not supported */ } };

/**
 * The last game, as the ONE card on the event page. Expanded it is the full
 * recap (scoreboard, what is left for the viewer, three links); collapsed it
 * is a one-line strip. Height and opacity animate between the two while the
 * scoreboard stays the same element.
 */
export function LastGameRecap(p: LastGameRecapProps) {
  const t = useT();
  const { eventId, status, expanded, tasks, role } = p;
  const [scoreOpen, setScoreOpen] = useState(!!p.autoOpenScore);
  const [mvpOpen, setMvpOpen] = useState(false);
  const selfReport = useSelfReport(eventId, status);
  const [saved, setSaved] = useState<[number, number] | null>(null);
  const [justDone, setJustDone] = useState<Array<{ kind: string; title: string; sub?: string }>>([]);

  const money = (amount: number) => formatMoney(toCents(amount), status.costCurrency);
  const detailsId = `recap-details-${eventId}`;
  const scoreOne = saved?.[0] ?? status.scoreOne;
  const scoreTwo = saved?.[1] ?? status.scoreTwo;
  const hasScore = scoreOne !== null && scoreTwo !== null;
  const historyId = status.latestHistoryId;
  const finish = (row: { kind: string; title: string; sub?: string }) => { cheer(); setJustDone((d) => [...d, row]); p.onChanged(); };

  const pay = async (task: Extract<RecapTask, { kind: "pay" }>) => {
    if (await selfReport.report(task.eventPlayerId)) {
      finish({ kind: "pay", title: t("recapPayReported", { amount: money(task.amount) }), sub: t("recapPayReportedSub", { payer: task.payerName }) });
    }
  };

  const rows = tasks.map((task) => {
    const key = task.kind;
    switch (task.kind) {
      case "addScore":
        return task.inline && historyId ? (
          <RecapTaskRow key={key} title={t("recapAddScoreTitle")} sub={t("recapAddScoreSub")} action={scoreOpen ? undefined : t("recapAddScoreAction")} onAction={() => setScoreOpen(true)}>
            {scoreOpen && (
              <AddScoreSteppers
                eventId={eventId} historyId={historyId} teamOneName={status.teamOneName} teamTwoName={status.teamTwoName}
                autoFocus={p.autoOpenScore}
                onSaved={(a, b) => { cheer(); setSaved([a, b]); setScoreOpen(false); p.onChanged(); }}
              />
            )}
          </RecapTaskRow>
        ) : (
          <RecapTaskRow key={key} title={t("recapAddScoreTitle")} sub={t("recapAddScoreSub")} action={t("recapAddScoreOpenHistory")} href={`/events/${eventId}/history`} />
        );
      case "mvp":
        return (
          <RecapTaskRow key={key} title={t("recapMvpTitle")} sub={t("recapMvpSub")} action={mvpOpen ? undefined : t("recapMvpAction")} onAction={() => setMvpOpen(true)}>
            {mvpOpen && historyId && (
              <MvpPicker
                eventId={eventId} historyId={historyId} selfName={p.viewerName}
                onVoted={(name) => { setMvpOpen(false); finish({ kind: "mvp", title: t("recapMvpDone", { name }) }); }}
              />
            )}
          </RecapTaskRow>
        );
      case "pay":
        return (
          <RecapTaskRow key={key} highlight={p.highlightPay} title={t("recapPayTitle", { amount: money(task.amount) })} sub={t("recapPaySub", { payer: task.payerName })}
            action={t("recapPayAction")} busy={selfReport.busy} onAction={() => pay(task)}>
            {selfReport.failed && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.875rem", px: 2, pb: 1.5 }}>{t("recapPayError")}</Typography>}
          </RecapTaskRow>
        );
      case "nopayer":
        return (
          <RecapTaskRow key={key} title={t("recapNoPayerTitle", { amount: money(task.amount) })}
            sub={t(task.canChoose ? "recapNoPayerSubAdmin" : "recapNoPayerSub")}
            action={task.canChoose ? t("recapNoPayerAction") : undefined} href={`/events/${eventId}/payments`} />
        );
      case "collect":
        return (
          <RecapTaskRow key={key} title={task.collector ? t("recapPaySub", { payer: task.collector }) : t("recapCollectTitle")} href={`/events/${eventId}/payments`} action={t("recapCollectAction")}
            sub={t("recapCollectSub", { collected: money(task.paidAmount), total: money(task.totalAmount), paid: task.paidCount, count: task.totalCount })} />
        );
    }
  });

  const pending = tasks.length > 0;
  const paySummary = summarizePayments(status.gamePayments ?? []);
  const showPayments = status.hasCost && role !== "signedOut";
  const links = [
    { label: t("recapLinkLineup"), icon: <GroupsIcon fontSize="small" />, href: `/events/${eventId}/history` },
    ...(showPayments ? [{
      label: t("recapLinkPayments"), icon: <PaymentsIcon fontSize="small" />, href: `/events/${eventId}/payments`,
      sub: status.gamePayments?.length ? t("recapLinkPaymentsSub", { paid: paySummary.paidCount, total: paySummary.totalCount }) : undefined,
    }] : []),
    { label: t("recapLinkRanking"), icon: <LeaderboardIcon fontSize="small" />, href: `/events/${eventId}/rankings`, sub: t("recapLinkRankingSub") },
  ];

  const toggleLabel = t(expanded ? "recapHideAria" : "recapShowAria");

  return (
    <Box
      data-testid="last-game-recap"
      sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: "20px", overflow: "hidden" }}
    >
      <Box
        data-testid="recap-scoreboard"
        onClick={expanded ? undefined : p.onToggle}
        sx={{ px: 2, pt: 1.5, pb: expanded ? 2.5 : 1.5, cursor: expanded ? "default" : "pointer", ...motion("padding") }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44, mr: -1 }}>
          <Typography sx={{ fontSize: "0.9375rem", color: "text.secondary" }}>{t("recapLastGame", { date: p.dateLabel })}</Typography>
          {(!expanded || p.canCollapse) && (
            <Button
              aria-expanded={expanded} aria-controls={detailsId} aria-label={toggleLabel}
              onClick={(e) => { e.stopPropagation(); p.onToggle(); }}
              endIcon={<ExpandMoreIcon sx={{ transform: expanded ? "rotate(180deg)" : "none", ...motion("transform") }} />}
              sx={{ minHeight: 44, minWidth: 44, textTransform: "none", fontWeight: 700, fontSize: "0.9375rem" }}
            >
              {t(expanded ? "recapHide" : "recapDetails")}
            </Button>
          )}
        </Box>
        <Scoreboard teamOneName={status.teamOneName} teamTwoName={status.teamTwoName} scoreOne={scoreOne} scoreTwo={scoreTwo} compact={!expanded} rollOnChange={!!saved} />
        <Typography sx={{ fontSize: expanded ? "1.0625rem" : "0.9375rem", fontWeight: 700, mt: 1, textWrap: "pretty", ...motion("font-size") }}>{p.summary}</Typography>
        {expanded && !hasScore && !tasks.some((x) => x.kind === "addScore") && (
          <Typography sx={{ fontSize: "0.9375rem", color: "text.secondary", mt: 0.5 }}>{t("recapScoreSoon")}</Typography>
        )}
      </Box>

      <Box
        id={detailsId} aria-hidden={!expanded} inert={!expanded}
        sx={{ display: "grid", gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0, ...motion("grid-template-rows, opacity") }}
      >
        <Box sx={{ overflow: "hidden", minHeight: 0 }}>
          {rows}
          {justDone.map((d) => <RecapTaskRow key={d.kind} done title={d.title} sub={d.sub} />)}
          {!pending && role !== "signedOut" && hasScore && justDone.length === 0 && <RecapTaskRow done title={t("recapAllDone")} />}
          {role === "signedOut" && (
            <RecapTaskRow testId="recap-signin" title={t("recapSignInRow")}>
              <Box sx={{ px: 2, pb: 2 }}>
                <SignInButton callbackURL={typeof window === "undefined" ? "/" : window.location.pathname} variant="contained" disableElevation
                  sx={{ minHeight: 44, borderRadius: 999, px: 2.5, fontWeight: 700, textTransform: "none" }}>
                  {t("signIn")}
                </SignInButton>
              </Box>
            </RecapTaskRow>
          )}
          <Box sx={{ display: "flex", borderTop: 1, borderColor: "divider" }}>
            {links.map((l, i) => (
              <Button
                key={l.href} component="a" href={l.href}
                sx={{ flex: 1, minHeight: 64, flexDirection: "column", gap: 0.25, borderRadius: 0, textTransform: "none", color: "text.primary", borderLeft: i ? 1 : 0, borderColor: "divider" }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: "1rem", fontWeight: 700 }}>{l.icon}{l.label}</Box>
                {l.sub && <Box sx={{ fontSize: "0.8125rem", color: "text.secondary" }}>{l.sub}</Box>}
              </Button>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
