import { useEffect, useEffectEvent, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import { useLocale } from "~/lib/useT";
import { nextOccurrence, parseRecurrenceRule } from "~/lib/recurrence";
import { benchLabelNames, nextGamePhase, rsvpView } from "~/lib/nextGame";
import { splitRoster } from "~/lib/rosterCapacity";
import type { EventPermissions } from "~/lib/eventView";
import type { EventData } from "../types";
import { ConfirmLeaveDialog, computeBenchEmptyAfter, computeWithin48h } from "../ConfirmLeaveDialog";
import { PaymentNudgeDialog } from "../PaymentNudgeDialog";
import { LineupSlots } from "./LineupSlots";
import { NextGameHeader } from "./NextGameHeader";
import { RsvpRow } from "./RsvpRow";
import { WaitingRow } from "./WaitingRow";
import { WhosIn } from "./WhosIn";
import { tappable } from "./styles";
import { useInviteActions } from "./useInviteActions";
import type { MyRsvp } from "./useMyRsvp";
import { useNextGameClock } from "./useNextGameClock";
import { usePaymentGate } from "./usePaymentGate";
import { useRosterActions } from "./useRosterActions";

export interface DrawControls {
  hasTeams: boolean;
  isDrawing: boolean;
  /** Draw now: the roster is full, or the organizer has already agreed to an early draw. */
  onDraw: () => void;
  onConfirmRedraw: () => void;
  onConfirmEarlyDraw: () => void;
}

export interface NextGameProps {
  eventId: string;
  event: EventData;
  setEvent: Dispatch<SetStateAction<EventData | null>>;
  refetch: () => Promise<void>;
  beginWrite: () => () => void;
  viewer: { id: string; name: string } | null;
  perms: EventPermissions;
  rsvp: MyRsvp;
  setRsvp: (next: MyRsvp) => void;
  /** The recap still has something for the viewer: the RSVP is then the quiet variant, not THE action. */
  recapBlocking: boolean;
  deepLinkAction: string | null;
  notify: (message: string) => void;
  onSignedIn: () => void;
  draw: DrawControls;
}

/**
 * The next game, flat on the page: its date, the viewer's answer, the lineup, the bench,
 * and who is still being waited for. Everything it decides lives in `src/lib/nextGame.ts`.
 */
export function NextGame(p: NextGameProps) {
  const { t } = useLocale();
  const { event, viewer, perms } = p;
  const rule = useMemo(() => parseRecurrenceRule(event.recurrenceRule), [event.recurrenceRule]);
  const startMs = useMemo(() => Date.parse(event.dateTime), [event.dateTime]);
  const durationMinutes = event.durationMinutes ?? 0;
  const now = useNextGameClock(startMs, startMs + durationMinutes * 60_000);
  const cancelled = event.gameStatus === "cancelled";
  const phase = nextGamePhase({ now, startMs, durationMinutes, weekly: !!rule, cancelled });

  const roster = useRosterActions({
    eventId: p.eventId, event, setEvent: p.setEvent, refetch: p.refetch, beginWrite: p.beginWrite,
    viewer, rsvp: p.rsvp, setRsvp: p.setRsvp, notify: p.notify,
  });
  const invites = useInviteActions({ eventId: p.eventId, refetch: p.refetch, notify: p.notify });
  const gate = usePaymentGate(p.eventId);

  const [nudgeOpen, setNudgeOpen] = useState(false);
  // The warnings the leave dialog shows are worked out when it opens, not on every render.
  const [leaving, setLeaving] = useState<{ benchEmptyAfter: boolean; within48h: boolean } | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const focusRow = () => rowRef.current?.focus();

  const { active, bench } = splitRoster(event.players, event.maxPlayers);
  const myRow = viewer ? event.players.find((x) => x.userId === viewer.id) ?? null : null;
  const teamName = myRow ? event.teamResults.find((tr) => tr.members.some((m) => m.name === myRow.name))?.name ?? null : null;
  const view = rsvpView({ viewerId: viewer?.id ?? null, players: event.players, maxPlayers: event.maxPlayers, rsvp: p.rsvp, teamName });

  const join = async (skipGate = false) => {
    if (!skipGate && (await gate.decide()) === "prompt") { setNudgeOpen(true); return; }
    const outcome = await roster.join();
    if (outcome === "payment") setNudgeOpen(true);
    else if (outcome !== "busy") focusRow();
  };
  const askToLeave = () => {
    if (!myRow) return;
    setLeaving({ benchEmptyAfter: computeBenchEmptyAfter(myRow.id, event.players, active, event.maxPlayers), within48h: computeWithin48h(event.dateTime) });
  };
  const decline = async () => { if (await roster.decline()) focusRow(); };

  // Deep links: ?action=join joins once the page is ready; ?action=pay opens the payment dialog.
  const handledRef = useRef({ join: false, pay: false });
  const canAct = phase === "open" || phase === "live";
  const hasViewer = !!viewer;
  const autoJoin = useEffectEvent(() => { void join(); });
  const autoPay = useEffectEvent(() => setNudgeOpen(true));
  useEffect(() => {
    if (!canAct || !hasViewer) return;
    if (p.deepLinkAction === "pay" && !handledRef.current.pay) { handledRef.current.pay = true; autoPay(); }
    if (p.deepLinkAction === "join" && !handledRef.current.join && view.kind === "choose") {
      handledRef.current.join = true;
      const timer = setTimeout(autoJoin, 500);
      return () => clearTimeout(timer);
    }
  }, [canAct, hasViewer, view.kind, p.deepLinkAction]);

  if (phase === "none" || phase === "cancelled") return null;

  const date = phase === "signupsSoon" && rule ? nextOccurrence(new Date(startMs), rule, new Date(now), event.timezone) : new Date(startMs);
  const spotsLeft = Math.max(0, event.maxPlayers - active.length);
  const summary = spotsLeft === 0 ? t("ngLineupFull", { max: event.maxPlayers })
    : t(spotsLeft === 1 ? "ngLineupOpenOne" : "ngLineupOpen", { n: active.length, max: event.maxPlayers, left: spotsLeft });
  const benchNames = benchLabelNames(bench.map((x) => x.name));
  const benchText = [...benchNames.names, ...(benchNames.more > 0 ? [t("ngBenchMore", { n: benchNames.more })] : [])].join(", ");
  const canDraw = perms.canEditSettings && active.length >= 2;
  const error = roster.error ?? invites.error;

  const drawNow = () => {
    if (p.draw.hasTeams) p.draw.onConfirmRedraw();
    else if (active.length < event.maxPlayers) p.draw.onConfirmEarlyDraw();
    else p.draw.onDraw();
  };

  return (
    <Box component="section" aria-label={t("nextGame")} data-testid="next-game">
      <NextGameHeader phase={phase} date={date} timezone={event.timezone} now={now} startMs={startMs} />

      {phase !== "signupsSoon" && (
        <>
          <RsvpRow
            view={view} emphasis={!p.recapBlocking} busy={roster.busy} eventId={p.eventId} rowRef={rowRef}
            highlight={p.deepLinkAction === "rsvp"} onSignedIn={p.onSignedIn}
            onJoin={() => void join()} onDecline={() => void decline()} onLeave={askToLeave}
          />

          {error && (
            <Alert severity="error" onClose={() => { roster.clearError(); invites.clearError(); }} sx={{ mt: 1.5 }}>{error}</Alert>
          )}

          {event.maxPlayers > 0 && (
            <Box sx={{ mt: 2.5 }}>
              <LineupSlots players={active} maxPlayers={event.maxPlayers} viewerId={viewer?.id ?? null} />
              <Typography data-testid="lineup-summary" sx={{ mt: 1.25, fontSize: "0.9375rem", lineHeight: 1.45, color: "text.secondary", textWrap: "pretty" }}>{summary}</Typography>
              {bench.length > 0 && (
                <Typography data-testid="bench-line" sx={{ mt: 1, fontSize: "0.9375rem", lineHeight: 1.45, textWrap: "pretty" }}>
                  <Box component="b">{t("ngBenchHeading", { n: bench.length })}</Box> · {t(bench.length === 1 ? "ngBenchLineOne" : "ngBenchLine", { names: benchText })}
                </Typography>
              )}
              <WhosIn playing={active} bench={bench} viewerId={viewer?.id ?? null} positionsEnabled={!!event.positionsEnabled} />
              <WaitingRow
                invited={event.invited ?? []} declined={event.declined ?? []} canManage={perms.canManageInvites}
                resendingId={invites.resendingId} retractingId={invites.retractingId} onResend={invites.resend} onRetract={invites.retract}
              />
              {canDraw && !cancelled && (
                <Button
                  startIcon={<ShuffleIcon />} variant={p.draw.hasTeams ? "text" : "outlined"} disabled={p.draw.isDrawing} aria-busy={p.draw.isDrawing || undefined}
                  onClick={drawNow}
                  sx={{ mt: 1, minHeight: 48, borderRadius: 999, textTransform: "none", fontWeight: 700, ...(p.draw.hasTeams ? { color: "text.secondary" } : { color: "text.primary", borderColor: "divider" }), ...tappable }}
                >
                  {p.draw.hasTeams ? t("ngDrawAgain") : t("ngDrawNow")}
                </Button>
              )}
            </Box>
          )}
        </>
      )}

      {viewer && (
        <PaymentNudgeDialog
          eventId={event.id} open={nudgeOpen} onClose={() => setNudgeOpen(false)}
          onJoin={async () => { setNudgeOpen(false); await join(true); }}
        />
      )}

      <ConfirmLeaveDialog
        open={!!leaving} onClose={() => setLeaving(null)} context="self" playerName={myRow?.name ?? viewer?.name ?? ""}
        benchEmptyAfter={leaving?.benchEmptyAfter ?? false} within48h={leaving?.within48h ?? false} busy={leaveBusy}
        onExited={focusRow}
        onConfirm={async () => {
          setLeaveBusy(true);
          try { await roster.leave(); } finally { setLeaveBusy(false); setLeaving(null); }
        }}
      />
    </Box>
  );
}
