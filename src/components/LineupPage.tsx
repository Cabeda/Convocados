/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: fetch sets state. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, CircularProgress, Container, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { SignInButton } from "./SignInButton";
import { ConfirmLeaveDialog, computeBenchEmptyAfter, computeWithin48h } from "./event/ConfirmLeaveDialog";
import type { EventData, Player } from "./event/types";
import { ManageLineup } from "./event/story/ManageLineup";
import { HeaderToast, useHeaderToasts } from "./event/story/HeaderToast";
import { UndoToast } from "./event/story/UndoToast";
import { UNDO_WINDOW_MS, useRosterRemoval } from "./event/story/useRosterRemoval";
import { useLocale } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { ApiError, apiRequest } from "~/lib/api/client";
import { deriveEventPermissions } from "~/lib/eventView";
import { splitRoster } from "~/lib/rosterCapacity";

/** /events/[id]/lineup — the organizer's page for the list: order, positions, remove. Not part of the game page. */
export default function LineupPage({ eventId }: { eventId: string }) {
  const { t, locale } = useLocale();
  const { data: session, refetch: refetchSession } = useSession();
  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const { queue: toastQueue, push: setToast, next: nextToast } = useHeaderToasts();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ player: Player; benchEmptyAfter: boolean; within48h: boolean } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [askingReset, setAskingReset] = useState(false);
  /** The order before a reset, offered back for a minute. */
  const [resetUndo, setResetUndo] = useState<string[] | null>(null);

  // A poll that lands while the organizer's own change is in flight must not undo it.
  const writesRef = useRef({ active: 0, lastEnd: 0 });
  const beginWrite = useCallback(() => {
    writesRef.current.active += 1;
    return () => { writesRef.current.active -= 1; writesRef.current.lastEnd = Date.now(); };
  }, []);

  const refetch = useCallback(async () => {
    const started = Date.now();
    try {
      const data = (await apiRequest("GET /api/events/{id}", { params: { id: eventId } })) as EventData & { locked?: boolean };
      if (writesRef.current.active > 0 || started < writesRef.current.lastEnd) return;
      setFailed(false);
      setNotFound(false);
      setLocked(!!data.locked);
      if (!data.locked) setEvent(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setNotFound(true); setEvent(null); } else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // The page speaks the viewer's language to the browser too: the document language and the tab title.
  useEffect(() => {
    const before = document.documentElement.lang;
    document.documentElement.lang = locale;
    document.title = event ? `${t("ngManageTitle")} — ${event.title}` : t("ngManageTitle");
    return () => { document.documentElement.lang = before; };
  }, [locale, t, event]);

  const perms = deriveEventPermissions(
    session?.user?.id ?? null,
    { ownerId: event?.ownerId ?? null, isPublic: !!event?.isPublic, isAdmin: !!event?.isAdmin },
  );
  const removal = useRosterRemoval({
    eventId, players: event?.players ?? [], setEvent, refetch, beginWrite, perms, notify: setToast,
  });

  // The order as the viewer sees it now, kept in step with every tap — so a second tap before the first has
  // been saved is worked out from the first, not from the order the server last sent.
  const orderRef = useRef<string[]>([]);
  useEffect(() => { orderRef.current = (event?.players ?? []).map((p) => p.id); }, [event]);

  // Requests go out one after the other, in the order they were tapped, so the last tap is the one that stands.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const send = (request: () => Promise<unknown>) => {
    setError(null);
    const end = beginWrite();
    chainRef.current = chainRef.current.then(request).then(() => true, () => false).then(async (ok) => {
      if (!ok) setError(t("ngManageError"));
      end();
      await refetch();
    });
  };

  const applyOrder = (ids: string[]) => {
    orderRef.current = ids;
    setEvent((e) => {
      if (!e) return e;
      const byId = new Map(e.players.map((p) => [p.id, p]));
      return { ...e, players: ids.flatMap((id) => byId.get(id) ?? []) };
    });
  };
  const saveOrder = (ids: string[]) => send(() => apiRequest("PUT /api/events/{id}/reorder-players", { params: { id: eventId }, body: { playerIds: ids } }));

  const move = (playerId: string, target: { by: number } | { to: number }) => {
    const ids = [...orderRef.current];
    const from = ids.indexOf(playerId);
    const to = "by" in target ? from + target.by : target.to;
    if (from < 0 || to < 0 || to >= ids.length || to === from) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    applyOrder(ids);
    saveOrder(ids);
  };

  const reset = () => {
    setAskingReset(false);
    const previous = [...orderRef.current];
    send(async () => {
      await apiRequest("POST /api/events/{id}/reset-player-order", { params: { id: eventId } });
      setResetUndo(previous);
    });
  };
  const undoReset = () => {
    if (!resetUndo) return;
    const ids = resetUndo;
    setResetUndo(null);
    applyOrder(ids);
    saveOrder(ids);
  };
  useEffect(() => {
    if (!resetUndo) return;
    const id = setTimeout(() => setResetUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(id);
  }, [resetUndo]);

  const setPosition = (name: string, position: string | null) =>
    send(() => apiRequest("PATCH /api/events/{id}/players", { params: { id: eventId }, body: { name, position } }));

  const ask = (player: Player) => {
    if (!event) return;
    // An anonymous row has nobody to warn: remove at once (Undo is there). A linked player gets the dialog.
    if (!player.userId) { void removal.remove(player); return; }
    setConfirm({
      player,
      benchEmptyAfter: computeBenchEmptyAfter(player.id, event.players, splitRoster(event.players, event.maxPlayers).active, event.maxPlayers),
      within48h: computeWithin48h(event.dateTime),
    });
  };

  const backToGame = (
    <Button href={`/events/${eventId}`} startIcon={<ArrowBackIcon />} sx={{ alignSelf: "flex-start", minHeight: 44, textTransform: "none", fontWeight: 700 }}>{t("backToGame")}</Button>
  );

  let body;
  if (loading) body = <CircularProgress aria-label={t("ngLoading")} />;
  else if (locked) body = <Alert severity="info">{t("ngManageLocked")}</Alert>;
  else if (notFound) {
    body = (
      <Stack spacing={0.5}>
        <Typography component="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>{t("gameNotFound")}</Typography>
        <Typography sx={{ color: "text.secondary" }}>{t("gameNotFoundDesc")}</Typography>
      </Stack>
    );
  } else if (failed || !event) {
    body = (
      <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <Alert severity="error" sx={{ width: "100%" }}>{t("ngLoadFailed")}</Alert>
        <Button variant="outlined" onClick={() => { setLoading(true); void refetch(); }} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700 }}>{t("ngTryAgain")}</Button>
      </Stack>
    );
  } else if (!perms.canEditSettings) {
    body = (
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <Alert severity="info" sx={{ width: "100%" }}>{t("ngManageOnlyOrganizer")}</Alert>
        {!session?.user && (
          <SignInButton variant="contained" callbackURL={`/events/${eventId}/lineup`} onSuccess={() => { void refetchSession?.(); void refetch(); }}>
            {t("ngManageSignIn")}
          </SignInButton>
        )}
      </Stack>
    );
  } else {
    body = (
      <>
        <ManageLineup
          players={event.players} maxPlayers={event.maxPlayers} positionsEnabled={!!event.positionsEnabled}
          onMove={move} onResetOrder={() => setAskingReset(true)} onSetPosition={setPosition}
          onRemove={ask} error={error ?? removal.error} onDismissError={() => { setError(null); removal.clearError(); }}
        />
        {removal.undo && <UndoToast message={t("undoRemoveDesc", { name: removal.undo.name })} onUndo={() => void removal.runUndo()} onDismiss={removal.dismissUndo} />}
        {resetUndo && <UndoToast message={t("ngOrderReset")} onUndo={undoReset} onDismiss={() => setResetUndo(null)} />}
      </>
    );
  }

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 4 }}>
          <Stack spacing={2}>
            {backToGame}
            <Typography component="h1" sx={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.15 }}>{t("ngManageTitle")}</Typography>
            {event && <Typography sx={{ color: "text.secondary", mt: -1 }}>{event.title}</Typography>}
            {body}
          </Stack>
        </Container>
        <Dialog open={askingReset} onClose={() => setAskingReset(false)} maxWidth="xs" fullWidth aria-labelledby="reset-order-title">
          <DialogTitle id="reset-order-title">{t("ngResetTitle")}</DialogTitle>
          <DialogContent><DialogContentText>{t("ngResetBody")}</DialogContentText></DialogContent>
          <DialogActions>
            <Button onClick={() => setAskingReset(false)}>{t("ngResetKeep")}</Button>
            <Button onClick={reset} variant="contained" color="primary">{t("ngResetConfirm")}</Button>
          </DialogActions>
        </Dialog>
        <ConfirmLeaveDialog
          open={!!confirm} onClose={() => setConfirm(null)} context="organizer" playerName={confirm?.player.name ?? ""}
          benchEmptyAfter={confirm?.benchEmptyAfter ?? false} within48h={confirm?.within48h ?? false} busy={confirmBusy}
          onConfirm={async () => {
            if (!confirm) return;
            setConfirmBusy(true);
            try { await removal.remove(confirm.player); } finally { setConfirmBusy(false); setConfirm(null); }
          }}
        />
        <HeaderToast queue={toastQueue} onDone={nextToast} />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
