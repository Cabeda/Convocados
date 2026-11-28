/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: fetch sets state. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, CircularProgress, Container, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { SignInButton } from "./SignInButton";
import { ConfirmLeaveDialog, computeBenchEmptyAfter, computeWithin48h } from "./event/ConfirmLeaveDialog";
import type { EventData, Player } from "./event/types";
import { ManageLineup } from "./event/story/ManageLineup";
import { HeaderToast, useHeaderToasts } from "./event/story/HeaderToast";
import { UndoToast } from "./event/story/UndoToast";
import { useRosterRemoval } from "./event/story/useRosterRemoval";
import { useLocale } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { ApiError, apiRequest } from "~/lib/api/client";
import { deriveEventPermissions } from "~/lib/eventView";
import { splitRoster } from "~/lib/rosterCapacity";

/** /events/[id]/lineup — the organizer's page for the list: order, positions, remove. Not part of the game page. */
export default function LineupPage({ eventId }: { eventId: string }) {
  const { t } = useLocale();
  const { data: session, refetch: refetchSession } = useSession();
  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const { queue: toastQueue, push: setToast, next: nextToast } = useHeaderToasts();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ player: Player; benchEmptyAfter: boolean; within48h: boolean } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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
      if (!data.locked) setEvent(data);
      setFailed(false);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) setFailed(true); else setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const perms = deriveEventPermissions(
    session?.user?.id ?? null,
    { ownerId: event?.ownerId ?? null, isPublic: !!event?.isPublic, isAdmin: !!event?.isAdmin },
  );
  const removal = useRosterRemoval({
    eventId, players: event?.players ?? [], setEvent, refetch, beginWrite, perms, notify: setToast,
  });

  const run = async (request: () => Promise<unknown>) => {
    setError(null);
    const end = beginWrite();
    try { await request(); } catch { setError(t("ngManageError")); } finally { end(); }
    await refetch();
  };

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

  let body;
  if (loading) body = <CircularProgress aria-label={t("ngLoading")} />;
  else if (failed || !event) body = <Alert severity="error">{t("somethingWentWrong")}</Alert>;
  else if (!perms.canEditSettings) {
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
          onReorder={(ids) => void run(() => apiRequest("PUT /api/events/{id}/reorder-players", { params: { id: eventId }, body: { playerIds: ids } }))}
          onResetOrder={() => void run(() => apiRequest("POST /api/events/{id}/reset-player-order", { params: { id: eventId } }))}
          onSetPosition={(name, position) => void run(() => apiRequest("PATCH /api/events/{id}/players", { params: { id: eventId }, body: { name, position } }))}
          onRemove={ask} error={error ?? removal.error} onDismissError={() => { setError(null); removal.clearError(); }}
        />
        {removal.undo && <UndoToast undo={removal.undo} onUndo={() => void removal.runUndo()} onDismiss={removal.dismissUndo} />}
      </>
    );
  }

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 4 }}>
          <Stack spacing={2}>
            <Button href={`/events/${eventId}`} startIcon={<ArrowBackIcon />} sx={{ alignSelf: "flex-start", minHeight: 44, textTransform: "none", fontWeight: 700 }}>{t("backToGame")}</Button>
            <Typography component="h1" sx={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.15 }}>{t("ngManageTitle")}</Typography>
            {event && <Typography sx={{ color: "text.secondary", mt: -1 }}>{event.title}</Typography>}
            {body}
          </Stack>
        </Container>
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
