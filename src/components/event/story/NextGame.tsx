import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import { useLocale } from "~/lib/useT";
import { nextOccurrence, parseRecurrenceRule } from "~/lib/recurrence";
import { benchLabelNames, canUndoRemoval, nextGamePhase, removeRule, rsvpView, slotLabels, type RemoveRule } from "~/lib/nextGame";
import { splitRoster } from "~/lib/rosterCapacity";
import { findSelfRosterRow, type EventPermissions } from "~/lib/eventView";
import { apiRequest } from "~/lib/api/client";
import { addedNamesHere, forgetAdded } from "~/lib/addedHere";
import { normalizeForMatch } from "~/lib/stringMatch";
import type { EventData, Player } from "../types";
import { ConfirmLeaveDialog, computeBenchEmptyAfter, computeWithin48h } from "../ConfirmLeaveDialog";
import { InviteShareDialog } from "../InviteShareDialog";
import { PaymentNudgeDialog } from "../PaymentNudgeDialog";
import { AddFriendPanel } from "./AddFriendPanel";
import { LineupSlots } from "./LineupSlots";
import { NextGameHeader } from "./NextGameHeader";
import { PlayerOptions } from "./PlayerOptions";
import { RsvpRow } from "./RsvpRow";
import { UndoToast } from "./UndoToast";
import { WaitingRow } from "./WaitingRow";
import { WhosIn } from "./WhosIn";
import { controlBorder, srOnly, tappable } from "./styles";
import { useFriendActions } from "./useFriendActions";
import { useFriendSuggestions } from "./useFriendSuggestions";
import { useInviteActions } from "./useInviteActions";
import type { MyRsvp } from "./useMyRsvp";
import { useNextGameClock } from "./useNextGameClock";
import { usePaymentGate } from "./usePaymentGate";
import { useRosterActions } from "./useRosterActions";
import { useRosterAnnouncements } from "./useRosterAnnouncements";
import { useRosterRemoval } from "./useRosterRemoval";

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
  const { t, locale } = useLocale();
  const { event, viewer, perms } = p;
  const rule = useMemo(() => parseRecurrenceRule(event.recurrenceRule), [event.recurrenceRule]);
  const startMs = useMemo(() => Date.parse(event.dateTime), [event.dateTime]);
  const durationMinutes = event.durationMinutes ?? 0;
  const now = useNextGameClock(startMs, startMs + durationMinutes * 60_000);
  const cancelled = event.gameStatus === "cancelled";
  const phase = nextGamePhase({ now, startMs, durationMinutes, weekly: !!rule, cancelled });

  // The viewer's own changes are tracked, so the polite announcement of OTHER people's changes stays out of their way.
  const ownWrites = useRef({ active: 0, lastEnd: 0 });
  const upstreamBegin = p.beginWrite;
  const beginWrite = useCallback(() => {
    ownWrites.current.active += 1;
    const end = upstreamBegin();
    return () => { end(); ownWrites.current.active -= 1; ownWrites.current.lastEnd = Date.now(); };
  }, [upstreamBegin]);
  const viewerBusy = useCallback(() => ownWrites.current.active > 0 || Date.now() - ownWrites.current.lastEnd < 2500, []);
  const announcement = useRosterAnnouncements(event.players, viewer?.id ?? null, viewerBusy);

  const roster = useRosterActions({
    eventId: p.eventId, event, setEvent: p.setEvent, refetch: p.refetch, beginWrite,
    viewer, rsvp: p.rsvp, setRsvp: p.setRsvp, notify: p.notify,
  });
  const invites = useInviteActions({ eventId: p.eventId, refetch: p.refetch, notify: p.notify });
  const gate = usePaymentGate(p.eventId);
  const removal = useRosterRemoval({ eventId: p.eventId, players: event.players, setEvent: p.setEvent, refetch: p.refetch, beginWrite, perms, notify: p.notify });

  const [nudgeOpen, setNudgeOpen] = useState(false);
  // The warnings the leave dialog shows are worked out when it opens, not on every render.
  const [leaving, setLeaving] = useState<{ player: Player; benchEmptyAfter: boolean; within48h: boolean } | null>(null);
  // "That's you?": the viewer tapped "I'm in" and a row with their own name, but no account, was already there.
  const [thatsYou, setThatsYou] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  // Add a friend: the panel, opened from the button or an open slot. Its lists are read the first time it opens.
  const [adding, setAdding] = useState(false);
  const [addingEver, setAddingEver] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Options for one person (remove), opened from their slot or their row in "Who's in".
  const [selection, setSelection] = useState<{ id: string; from: "slot" | "row" } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ player: Player; guest: boolean; benchEmptyAfter: boolean; within48h: boolean } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const focusRow = () => rowRef.current?.focus();

  const { active, bench } = splitRoster(event.players, event.maxPlayers);
  const myRow = viewer ? event.players.find((x) => x.userId === viewer.id) ?? null : null;
  // A row an organizer added under the viewer's name before they signed in: theirs to leave or claim, never linked by guesswork (#1331).
  const nameRow = viewer && !myRow ? findSelfRosterRow(event.players, viewer) : null;
  const teamName = myRow ? event.teamResults.find((tr) => tr.members.some((m) => m.name === myRow.name))?.name ?? null : null;
  const takenNames = [...event.players.map((x) => x.name), ...(event.invited ?? []).map((x) => x.name)];
  const takenKey = takenNames.join("\u0000");
  const takenStable = useMemo(() => (takenKey ? takenKey.split("\u0000") : []), [takenKey]);
  const suggestions = useFriendSuggestions({
    eventId: p.eventId, enabled: addingEver, signedIn: !!viewer, organizer: perms.canManageInvites, hasGame: !!event.gameId, takenNames: takenStable,
  });
  const friends = useFriendActions({ add: roster.add, invites, signedIn: !!viewer, takenNames: takenStable, notify: p.notify });
  // The server lets anyone take an anonymous row off; the page narrows it (see removeRule).
  const addedHere = addedNamesHere(p.eventId);
  const ruleFor = (player: Player): RemoveRule => removeRule({
    viewerId: viewer?.id ?? null, organizer: perms.isOwner || perms.isAdmin, player, addedHere: addedHere.has(normalizeForMatch(player.name)),
    nameMatch: nameRow?.id === player.id,
  });
  const canRemove = (player: Player) => ruleFor(player) !== "none";
  const isSelf = (player: Player) => ruleFor(player) === "self";
  const view = rsvpView({ viewerId: viewer?.id ?? null, players: event.players, maxPlayers: event.maxPlayers, rsvp: p.rsvp, teamName });

  const join = async (skipGate = false) => {
    if (!skipGate && (await gate.decide()) === "prompt") { setNudgeOpen(true); return; }
    const outcome = await roster.join();
    if (outcome === "payment") setNudgeOpen(true);
    else if (outcome === "alreadyIn" && nameRow) {
      // Not an error: that row is probably them. Open its options, with focus on Leave.
      roster.clearError();
      setThatsYou(true);
      setSelection({ id: nameRow.id, from: active.some((x) => x.id === nameRow.id) ? "slot" : "row" });
    } else if (outcome !== "busy") focusRow();
  };
  const askToLeave = (row: Player | null = myRow ?? nameRow) => {
    if (!row) return;
    setLeaving({ player: row, benchEmptyAfter: computeBenchEmptyAfter(row.id, event.players, active, event.maxPlayers), within48h: computeWithin48h(event.dateTime) });
  };
  const claim = async (player: Player) => {
    setClaiming(true);
    setSelection(null);
    setThatsYou(false);
    const end = beginWrite();
    try {
      await apiRequest("POST /api/events/{id}/claim-player", { params: { id: p.eventId }, body: { playerId: player.id } });
      end();
      await p.refetch();
      focusRow();
    } catch {
      end();
      roster.setError(t("ngClaimError", { name: player.name }));
      void p.refetch();
    } finally { setClaiming(false); }
  };
  const closeOptions = () => {
    const was = selection;
    setSelection(null);
    // Back to where the options were opened from, so a keyboard user keeps their place.
    if (was) setTimeout(() => document.querySelector<HTMLElement>(`[data-trigger="${was.from}:${was.id}"]`)?.focus(), 0);
  };
  const doRemove = async (player: Player) => {
    setSelection(null);
    const ok = await removal.remove(player);
    if (ok) forgetAdded(p.eventId, player.name);
    // Nobody to offer Undo to: say what happened instead.
    if (ok && !canUndoRemoval(perms)) p.notify(t("undoRemoveDesc", { name: player.name }));
    setTimeout(() => addButtonRef.current?.focus(), 0);
  };
  const requestRemove = (player: Player) => {
    const rule = ruleFor(player);
    if (rule === "none") return;
    if (rule === "self") { setSelection(null); askToLeave(player); return; }
    if (rule === "direct") { void doRemove(player); return; }
    setSelection(null);
    setRemoveConfirm({
      player, guest: rule === "confirmGuest", benchEmptyAfter: computeBenchEmptyAfter(player.id, event.players, active, event.maxPlayers), within48h: computeWithin48h(event.dateTime),
    });
  };
  const select = (player: Player, from: "slot" | "row") => {
    if (selection?.id === player.id && selection.from === from) closeOptions(); else setSelection({ id: player.id, from });
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

  if (phase === "none") return null;
  // A cancelled game keeps its list for reading — who was in — and nothing to press.
  if (phase === "cancelled") {
    return (
      <Box component="section" aria-label={t("ngWhosIn")} data-testid="cancelled-roster" sx={{ maxWidth: "32rem" }}>
        <WhosIn autoOpen playing={active} bench={bench} viewerId={viewer?.id ?? null} positionsEnabled={!!event.positionsEnabled} />
      </Box>
    );
  }

  const date = phase === "signupsSoon" && rule ? nextOccurrence(new Date(startMs), rule, new Date(now), event.timezone) : new Date(startMs);
  const spotsLeft = Math.max(0, event.maxPlayers - active.length);
  const summary = spotsLeft === 0 ? t("ngLineupFull", { max: event.maxPlayers })
    : t(spotsLeft === 1 ? "ngLineupOpenOne" : "ngLineupOpen", { n: active.length, max: event.maxPlayers, left: spotsLeft });
  const benchNames = benchLabelNames(bench.map((x) => x.name));
  // "Next up: Kátia L., Luís F., Marta S. and 1 more" — a list of names, then how many more.
  const nextUp = benchNames.more > 0
    ? t(benchNames.more === 1 ? "ngNextUpMoreOne" : "ngNextUpMore", { names: benchNames.names.join(", "), n: benchNames.more })
    : t("ngNextUp", { names: new Intl.ListFormat(locale, { type: "conjunction" }).format(benchNames.names) });
  const canDraw = perms.canEditSettings && active.length >= 2;
  const error = roster.error ?? invites.error ?? removal.error;

  const drawNow = () => {
    if (p.draw.hasTeams) p.draw.onConfirmRedraw();
    else if (active.length < event.maxPlayers) p.draw.onConfirmEarlyDraw();
    else p.draw.onDraw();
  };

  return (
    <Box component="section" aria-label={t("nextGame")} data-testid="next-game" sx={{ maxWidth: "32rem" }}>
      {/* Other people joining or leaving, read out politely by a screen reader; never shown. */}
      <Box role="status" aria-live="polite" aria-atomic data-testid="roster-announcement" sx={srOnly}>{announcement}</Box>
      <NextGameHeader phase={phase} date={date} timezone={event.timezone} now={now} startMs={startMs} />

      {phase !== "signupsSoon" && (
        <>
          <RsvpRow
            view={view} emphasis={!p.recapBlocking} busy={roster.busy} eventId={p.eventId} rowRef={rowRef}
            highlight={p.deepLinkAction === "rsvp"} onSignedIn={p.onSignedIn}
            onJoin={() => void join()} onDecline={() => void decline()} onLeave={() => askToLeave()}
          />

          {thatsYou && nameRow && (
            <Typography data-testid="thats-you" role="status" sx={{ mt: 1.5, fontSize: "1rem", lineHeight: 1.45, textWrap: "pretty" }}>{t("ngThatsYou")}</Typography>
          )}

          {error && (
            <Alert severity="error" onClose={() => { roster.clearError(); invites.clearError(); removal.clearError(); }} sx={{ mt: 1.5 }}>{error}</Alert>
          )}

          {event.maxPlayers > 0 && (
            <Box sx={{ mt: 2.5 }}>
              <LineupSlots
                players={active} maxPlayers={event.maxPlayers} viewerId={viewer?.id ?? null}
                canPress={canRemove} selectedId={selection?.from === "slot" ? selection.id : null} onPress={(pl) => select(pl, "slot")}
                controlsId="slot-options" onOpenSpot={() => { setAdding(true); setAddingEver(true); }}
                options={(() => {
                  const chosen = selection?.from === "slot" ? event.players.find((x) => x.id === selection.id) : null;
                  return chosen ? <PlayerOptions id="slot-options" player={chosen} onRemove={() => requestRemove(chosen)} onClose={closeOptions} disabled={removal.busy} self={isSelf(chosen)} onClaim={nameRow?.id === chosen.id ? () => void claim(chosen) : undefined} /> : null;
                })()}
              />
              <Typography data-testid="lineup-summary" sx={{ mt: 1.25, fontSize: "0.9375rem", lineHeight: 1.45, color: "text.secondary", textWrap: "pretty" }}>{summary}</Typography>
              {bench.length > 0 && (
                <Typography data-testid="bench-line" sx={{ mt: 1, fontSize: "0.9375rem", lineHeight: 1.45, textWrap: "pretty" }}>
                  {nextUp}
                </Typography>
              )}
              <WhosIn
                autoOpen={slotLabels(active.map((x) => x.name)).collides}
                playing={active} bench={bench} viewerId={viewer?.id ?? null} positionsEnabled={!!event.positionsEnabled}
                canSelect={canRemove} selectedId={selection?.from === "row" ? selection.id : null} onSelect={(pl) => select(pl, "row")}
                options={(pl) => <PlayerOptions player={pl} onRemove={() => requestRemove(pl)} onClose={closeOptions} disabled={removal.busy || claiming} self={isSelf(pl)} onClaim={nameRow?.id === pl.id ? () => void claim(pl) : undefined} />}
              />
              <WaitingRow
                invited={event.invited ?? []} declined={event.declined ?? []} canManage={perms.canManageInvites}
                resendingId={invites.resendingId} retractingId={invites.retractingId} onResend={invites.resend} onRetract={invites.retract}
              />
              <Button
                ref={addButtonRef} variant="outlined" startIcon={<PersonAddIcon />} aria-expanded={adding} aria-controls="add-friend"
                onClick={() => { setAdding((a) => !a); setAddingEver(true); }}
                sx={{ mt: 1, mr: 1, minHeight: 48, borderRadius: 999, textTransform: "none", fontWeight: 700, color: "text.primary", borderColor: controlBorder, ...tappable }}
              >
                {t("ngAddFriend")}
              </Button>
              {adding && (
                <Box id="add-friend">
                  <AddFriendPanel
                    full={event.players.length >= event.maxPlayers} positionsEnabled={!!event.positionsEnabled} suggestions={suggestions} busy={friends.busy || roster.busy}
                    onSubmit={friends.submit} onAddNamedEmail={friends.submitNamedEmail} onSubmitMany={friends.submitMany} onLink={friends.linkFor}
                    onClose={() => { setAdding(false); setTimeout(() => addButtonRef.current?.focus(), 0); }}
                  />
                </Box>
              )}
              {removal.undo && <UndoToast undo={removal.undo} onUndo={() => void removal.runUndo()} onDismiss={removal.dismissUndo} />}
              {canDraw && !cancelled && (
                <Button
                  startIcon={<ShuffleIcon />} variant={p.draw.hasTeams ? "text" : "outlined"} disabled={p.draw.isDrawing} aria-busy={p.draw.isDrawing || undefined}
                  onClick={drawNow}
                  sx={{ mt: 1, minHeight: 48, borderRadius: 999, textTransform: "none", fontWeight: 700, ...(p.draw.hasTeams ? { color: "text.secondary" } : { color: "text.primary", borderColor: controlBorder }), ...tappable }}
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

      <InviteShareDialog open={!!invites.share} name={invites.share?.name ?? ""} url={invites.share?.url ?? ""} onClose={invites.closeShare} />

      <ConfirmLeaveDialog
        open={!!removeConfirm} onClose={() => setRemoveConfirm(null)} context={removeConfirm?.guest ? "guest" : "organizer"} playerName={removeConfirm?.player.name ?? ""}
        benchEmptyAfter={removeConfirm?.benchEmptyAfter ?? false} within48h={removeConfirm?.within48h ?? false} busy={removeBusy}
        onConfirm={async () => {
          if (!removeConfirm) return;
          setRemoveBusy(true);
          try { await doRemove(removeConfirm.player); } finally { setRemoveBusy(false); setRemoveConfirm(null); }
        }}
      />

      <ConfirmLeaveDialog
        open={!!leaving} onClose={() => setLeaving(null)} context="self" playerName={leaving?.player.name ?? myRow?.name ?? viewer?.name ?? ""}
        benchEmptyAfter={leaving?.benchEmptyAfter ?? false} within48h={leaving?.within48h ?? false} busy={leaveBusy}
        onExited={focusRow}
        onConfirm={async () => {
          setLeaveBusy(true);
          try {
            // A linked row leaves through /leave, which also records "no". A row with only the viewer's name is taken off, never linked.
            if (leaving && !leaving.player.userId) await doRemove(leaving.player);
            else await roster.leave();
          } finally { setLeaveBusy(false); setLeaving(null); }
        }}
      />
    </Box>
  );
}
