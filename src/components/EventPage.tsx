import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Button,
  CircularProgress, Alert,
} from "@mui/material";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { TeamPicker } from "./TeamPicker";
import { PaymentSection } from "./PaymentSection";
import type { Imatch } from "~/lib/random";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { addKnownName, getQjName } from "~/lib/knownNames";
import { useSession } from "~/lib/auth.client";

import {
  EventHeader,
  PlayerList,
  QuickJoin,
  EventDialogs,
  PasswordPrompt,
  useCountdown,
} from "./event";
import type { EventData, Player, KnownPlayer } from "./event";

// ── Main component ────────────────────────────────────────────────────────────

export default function EventPage({ eventId }: { eventId: string }) {
  const t = useT();
  const locale = detectLocale();
  const { data: session } = useSession();

  // ── UI state ────────────────────────────────────────────────────────────────
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [balanced, setBalanced] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [sport, setSport] = useState("football-5v5");
  const [relinquishConfirmOpen, setRelinquishConfirmOpen] = useState(false);
  const [claimPlayerConfirmOpen, setClaimPlayerConfirmOpen] = useState(false);
  const [playerToClaim, setPlayerToClaim] = useState<{ id: string; name: string } | null>(null);

  // ── ELO ratings for balanced mode ───────────────────────────────────────────
  const [ratingsResponse, setRatingsResponse] = useState<{ data: { name: string; rating: number }[] } | null>(null);
  useEffect(() => {
    if (!balanced) { setRatingsResponse(null); return; }
    fetch(`/api/events/${eventId}/ratings?limit=100`).then((r) => r.json()).then(setRatingsResponse);
  }, [balanced, eventId]);
  const ratingsMap = useMemo(() => {
    if (!ratingsResponse?.data) return undefined;
    const map: Record<string, number> = {};
    for (const r of ratingsResponse.data) map[r.name] = r.rating;
    return map;
  }, [ratingsResponse]);

  // ── Stable client ID ────────────────────────────────────────────────────────
  const clientId = useRef<string>("");
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    let id = localStorage.getItem("client_id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("client_id", id); }
    clientId.current = id;
  }, []);

  // ── Team state ──────────────────────────────────────────────────────────────
  const [localMatches, setLocalMatches] = useState<Imatch[] | null>(null);
  const [teamOneName, setTeamOneName] = useState("");
  const [teamTwoName, setTeamTwoName] = useState("");

  // ── Event data ──────────────────────────────────────────────────────────────
  const [event, setEvent] = useState<EventData | null>(null);
  const [error, setFetchError] = useState<{ status?: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lockedEvent, setLockedEvent] = useState<{ id: string; title: string } | null>(null);

  const fetchEvent = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}`);
      if (r.status === 404) { setFetchError({ status: 404 }); return; }
      const data = await r.json();
      if (data.locked) {
        setLockedEvent({ id: data.id, title: data.title });
        setEvent(null);
      } else {
        setEvent(data);
        setLockedEvent(null);
        setFetchError(null);
      }
    } catch (e) {
      setFetchError({});
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  // Initial fetch
  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  // Poll for updates every 10s
  useEffect(() => {
    const id = setInterval(fetchEvent, 10_000);
    return () => clearInterval(id);
  }, [fetchEvent]);

  // Re-fetch on window focus
  useEffect(() => {
    const onFocus = () => fetchEvent();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchEvent]);

  // ── Known players for autocomplete ──────────────────────────────────────────
  const [knownPlayersData, setKnownPlayersData] = useState<{ players: KnownPlayer[] } | null>(null);
  useEffect(() => {
    fetch(`/api/events/${eventId}/known-players`).then((r) => r.json()).then(setKnownPlayersData);
  }, [eventId]);

  const mergedSuggestions = useMemo(() => {
    const qjName = getQjName().trim();
    return (knownPlayersData?.players ?? [])
      .map((p) => ({ name: p.name, gamesPlayed: p.gamesPlayed ?? 1 }))
      .sort((a, b) => {
        if (qjName && a.name.toLowerCase() === qjName.toLowerCase()) return -1;
        if (qjName && b.name.toLowerCase() === qjName.toLowerCase()) return 1;
        return b.gamesPlayed - a.gamesPlayed;
      });
  }, [knownPlayersData]);

  const currentPlayerNames = useMemo(
    () => new Set((event?.players ?? []).map((p) => p.name.toLowerCase())),
    [event?.players]
  );

  const availableSuggestions = useMemo(
    () => mergedSuggestions.filter((s) => !currentPlayerNames.has(s.name.toLowerCase())),
    [mergedSuggestions, currentPlayerNames]
  );

  const notFound = error?.status === 404;

  useEffect(() => {
    if (event) document.title = `${event.title} — Convocados`;
    return () => { document.title = "Convocados"; };
  }, [event?.title]);

  // ── Sync localMatches from server ───────────────────────────────────────────
  const isDragging = useRef(false);
  useEffect(() => {
    if (!event || isDragging.current) return;
    if (event.teamResults.length > 0) {
      setLocalMatches(event.teamResults.map((tr) => ({
        team: tr.name,
        players: tr.members.map((m) => ({ name: m.name, order: m.order })),
      })));
    } else {
      setLocalMatches(null);
    }
    setTeamOneName(event.teamOneName);
    setTeamTwoName(event.teamTwoName);
    setIsPublic(event.isPublic);
    setBalanced(event.balanced);
    setSport(event.sport);
  }, [event]);

  // ── Player CRUD ─────────────────────────────────────────────────────────────

  const addPlayer = async (name: string, linkToAccount = false) => {
    if (!name.trim()) return;
    setPlayerError(null);
    const trimmed = name.trim().slice(0, 50);

    // Optimistic update
    setEvent((current) => {
      if (!current) return current;
      const optimisticPlayer: Player = { id: `temp-${Date.now()}`, name: trimmed, userId: null };
      return { ...current, players: [...current.players, optimisticPlayer] };
    });

    const res = await fetch(`/api/events/${eventId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId.current },
      body: JSON.stringify({ name: trimmed, linkToAccount }),
    });
    const json = await res.json();
    if (!res.ok) {
      setPlayerError(json.error);
      fetchEvent(); // revert optimistic update
      return;
    }
    addKnownName(trimmed);
    fetchEvent();
  };

  const removePlayer = async (playerId: string) => {
    // Optimistic update
    setEvent((current) => {
      if (!current) return current;
      return { ...current, players: current.players.filter((p) => p.id !== playerId) };
    });

    const res = await fetch(`/api/events/${eventId}/players`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId.current },
      body: JSON.stringify({ playerId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.undo) {
        setUndoData({ eventId, ...data.undo });
      }
    } else {
      fetchEvent();
      return;
    }
    fetchEvent();
  };

  // ── Undo remove ─────────────────────────────────────────────────────────────
  const [undoData, setUndoData] = useState<{ eventId: string; name: string; order: number; userId: string | null; removedAt: number } | null>(null);

  const handleUndo = useCallback(async () => {
    if (!undoData) return;
    const res = await fetch(`/api/events/${undoData.eventId}/undo-remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(undoData),
    });
    if (res.ok) {
      fetchEvent();
    } else {
      const json = await res.json();
      setPlayerError(json.error);
    }
    setUndoData(null);
  }, [undoData, fetchEvent]);

  useEffect(() => {
    if (!undoData) return;
    const timer = setTimeout(() => setUndoData(null), 60_000);
    return () => clearTimeout(timer);
  }, [undoData]);

  // ── Claim player ────────────────────────────────────────────────────────────

  const handleClaimPlayerConfirm = async () => {
    if (!playerToClaim) return;
    setClaimPlayerConfirmOpen(false);
    const res = await fetch(`/api/events/${eventId}/claim-player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerToClaim.id }),
    });
    if (res.ok) {
      setSnackbar(t("claimPlayerSuccess"));
      fetchEvent();
    } else {
      const json = await res.json();
      setPlayerError(json.error);
    }
    setPlayerToClaim(null);
  };

  const openClaimPlayerDialog = (playerId: string, playerName: string) => {
    setPlayerToClaim({ id: playerId, name: playerName });
    setClaimPlayerConfirmOpen(true);
  };

  // ── Player reorder ──────────────────────────────────────────────────────────

  const reorderPlayers = useCallback(async (reorderedIds: string[]) => {
    await fetch(`/api/events/${eventId}/reorder-players`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerIds: reorderedIds }),
    });
    fetchEvent();
  }, [eventId, fetchEvent]);

  const resetPlayerOrder = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/reset-player-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) fetchEvent();
  }, [eventId, fetchEvent]);

  // ── Team operations ─────────────────────────────────────────────────────────

  const doRandomize = async () => {
    setConfirmOpen(false);
    const qs = balanced ? "?balanced=true" : "";
    const res = await fetch(`/api/events/${eventId}/randomize${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const json = await res.json();
    if (!res.ok) { setPlayerError(json.error); return; }
    fetchEvent();
  };

  const handleTeamChange = async (matches: Imatch[]) => {
    setLocalMatches(matches);
    isDragging.current = true;
    await fetch(`/api/events/${eventId}/teams`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matches }),
    });
    isDragging.current = false;
    fetchEvent();
  };

  const handleTeamNameSave = async (one: string, two: string) => {
    await fetch(`/api/events/${eventId}/team-names`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamOneName: one, teamTwoName: two }),
    });
    fetchEvent();
  };

  // ── Title & location save ───────────────────────────────────────────────────

  const handleSaveTitle = async (title: string) => {
    await fetch(`/api/events/${eventId}/title`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    fetchEvent();
  };

  const handleSaveLocation = async (location: string) => {
    const res = await fetch(`/api/events/${eventId}/location`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location }),
    });
    const data = await res.json();
    if (location && !data.geocoded) {
      setSnackbar(t("locationNotGeocoded"));
    }
    fetchEvent();
  };

  const handleSaveDateTime = async (dateTime: string, timezone: string) => {
    await fetch(`/api/events/${eventId}/datetime`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateTime, timezone }),
    });
    fetchEvent();
  };

  // ── Ownership ───────────────────────────────────────────────────────────────

  const handleClaimOwnership = async () => {
    const res = await fetch(`/api/events/${eventId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      fetchEvent();
      setSnackbar(t("claimOwnership"));
    }
  };

  const handleRelinquishOwnership = async () => {
    setRelinquishConfirmOpen(false);
    const res = await fetch(`/api/events/${eventId}/claim`, { method: "DELETE" });
    if (res.ok) fetchEvent();
  };

  // ── Derived state ───────────────────────────────────────────────────────────

  const gameDate = event ? new Date(event.dateTime) : new Date();
  const countdown = useCountdown(gameDate, t("gameTime"));

  const isAuthenticated = !!session?.user;
  const isOwner = !!(session?.user && event?.ownerId && session.user.id === event.ownerId);
  const isOwnerless = !event?.ownerId;
  const canEditSettings = isOwnerless || isOwner;
  const userHasLinkedPlayer = isAuthenticated && (event?.players ?? []).some((p: any) => p.userId === session.user.id);
  const canClaimPlayer = isAuthenticated && !userHasLinkedPlayer;

  const canRemovePlayer = (player: Player) => {
    if (isOwner) return true;
    if (session?.user && player.userId === session.user.id) return true;
    if (!player.userId) return true;
    return false;
  };

  // ── Loading / locked / not found states ─────────────────────────────────────

  if (isLoading) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
          <CircularProgress />
        </Box>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  if (lockedEvent) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <PasswordPrompt eventId={lockedEvent.id} title={lockedEvent.title} onUnlocked={fetchEvent} />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  if (notFound || !event) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>{t("gameNotFound")}</Typography>
          <Typography color="text.secondary" gutterBottom>{t("gameNotFoundDesc")}</Typography>
          <Button variant="contained" href="/" sx={{ mt: 2 }}>{t("createNewGame")}</Button>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  const wasReset = event.wasReset ?? false;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>

            {wasReset && (
              <Alert severity="info" icon={<EventRepeatIcon />}>
                {t("recurringResetAlert", {
                  date: gameDate.toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB", {
                    weekday: "long", month: "long", day: "numeric",
                  }),
                })}
              </Alert>
            )}

            {/* Header */}
            <EventHeader
              eventId={eventId}
              event={event}
              sport={sport}
              gameDate={gameDate}
              countdown={countdown}
              canEditSettings={canEditSettings}
              isOwner={isOwner}
              isAuthenticated={isAuthenticated}
              isOwnerless={isOwnerless}
              localMatches={localMatches}
              onSaveTitle={handleSaveTitle}
              onSaveLocation={handleSaveLocation}
              onSaveDateTime={handleSaveDateTime}
              onClaimOwnership={handleClaimOwnership}
              onSnackbar={setSnackbar}
            />

            {/* Quick join — authenticated users only */}
            {isAuthenticated && session?.user?.name && (
              <QuickJoin
                userName={session.user.name}
                players={event.players}
                maxPlayers={event.maxPlayers}
                onJoin={addPlayer}
                onLeave={removePlayer}
              />
            )}

            {/* Players */}
            <PlayerList
              players={event.players}
              maxPlayers={event.maxPlayers}
              isOwner={isOwner}
              canClaimPlayer={canClaimPlayer}
              hasTeams={!!(localMatches && localMatches.length > 0)}
              availableSuggestions={availableSuggestions}
              playerError={playerError}
              onPlayerErrorChange={setPlayerError}
              onAddPlayer={addPlayer}
              onRemovePlayer={removePlayer}
              onReorderPlayers={reorderPlayers}
              onResetPlayerOrder={resetPlayerOrder}
              onRandomize={doRandomize}
              onConfirmReRandomize={() => setConfirmOpen(true)}
              onOpenClaimPlayerDialog={openClaimPlayerDialog}
              canRemovePlayer={canRemovePlayer}
            />

            {/* Payment tracking */}
            {(event.splitCostsEnabled !== false) && (
              <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
                <PaymentSection
                  eventId={eventId}
                  canEdit={canEditSettings}
                  activePlayerCount={Math.min(event.players.length, event.maxPlayers)}
                />
              </Paper>
            )}

            {/* Teams */}
            {localMatches && localMatches.length > 0 && (
              <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
                <Stack spacing={3}>
                  <Typography variant="h6" fontWeight={600}>{t("teams")}</Typography>
                  <TeamPicker
                    matches={localMatches.map((m) => ({
                      ...m,
                      team: m.team === event.teamOneName ? teamOneName
                        : m.team === event.teamTwoName ? teamTwoName : m.team,
                    }))}
                    onResultChange={handleTeamChange}
                    ratingsMap={balanced ? ratingsMap : undefined}
                    onTeamNameSave={canEditSettings ? (teamIdx, newName) => {
                      if (teamIdx === 0) {
                        setTeamOneName(newName);
                        handleTeamNameSave(newName, teamTwoName);
                      } else {
                        setTeamTwoName(newName);
                        handleTeamNameSave(teamOneName, newName);
                      }
                    } : undefined}
                  />
                </Stack>
              </Paper>
            )}

          </Stack>
        </Container>

        <EventDialogs
          confirmOpen={confirmOpen}
          onConfirmClose={() => setConfirmOpen(false)}
          onConfirmRandomize={doRandomize}
          relinquishConfirmOpen={relinquishConfirmOpen}
          onRelinquishClose={() => setRelinquishConfirmOpen(false)}
          onRelinquishConfirm={handleRelinquishOwnership}
          claimPlayerConfirmOpen={claimPlayerConfirmOpen}
          playerToClaim={playerToClaim}
          onClaimPlayerClose={() => { setClaimPlayerConfirmOpen(false); setPlayerToClaim(null); }}
          onClaimPlayerConfirm={handleClaimPlayerConfirm}
          snackbar={snackbar}
          onSnackbarClose={() => setSnackbar(null)}
          undoData={undoData}
          onUndoDismiss={() => setUndoData(null)}
          onUndo={handleUndo}
        />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
