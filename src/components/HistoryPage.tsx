/* eslint-disable @eslint-react/purity -- React Compiler hint, not a bug. Date objects during render are common and necessary for time-based UI (countdown, past detection, etc.) */
/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Container, Paper, Typography, Box, Stack, Button, Chip,
  CircularProgress, Alert, TextField,
  alpha, useTheme, Grid, Dialog, DialogTitle,
  DialogContent, DialogActions,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HistoryIcon from "@mui/icons-material/History";
import SaveIcon from "@mui/icons-material/Save";
import SportsIcon from "@mui/icons-material/Sports";
import AddCircleIcon from "@mui/icons-material/AddCircle";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { useSession } from "~/lib/auth.client";
import { computeGameUpdates, type EloUpdate } from "~/lib/elo";
import { ScoreRoller } from "./event/ScoreRoller";
import { PlayerAutocomplete } from "./event/PlayerAutocomplete";
import { HistoryCardFull, type HistoryCardFullEntry } from "./HistoryCardFull";

type HistoryEntry = HistoryCardFullEntry;

interface AddHistoricalGameDialogProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  defaultTeamOneName: string;
  defaultTeamTwoName: string;
  knownPlayers: { name: string; gamesPlayed: number; userId?: string | null }[];
  playerRatings: { name: string; rating: number; gamesPlayed: number }[];
  onSuccess: (entry: HistoryEntry) => void;
}

function AddHistoricalGameDialog({
  open,
  onClose,
  eventId,
  defaultTeamOneName,
  defaultTeamTwoName,
  knownPlayers,
  playerRatings,
  onSuccess,
}: AddHistoricalGameDialogProps) {
  const t = useT();
  const theme = useTheme();
  const [dateTime, setDateTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 1, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [teamOneName, setTeamOneName] = useState(defaultTeamOneName);
  const [teamTwoName, setTeamTwoName] = useState(defaultTeamTwoName);
  const [scoreOne, setScoreOne] = useState("");
  const [scoreTwo, setScoreTwo] = useState("");
  const [team1Players, setTeam1Players] = useState<{ name: string; order: number }[]>([]);
  const [team2Players, setTeam2Players] = useState<{ name: string; order: number }[]>([]);
  const [newPlayerInputs, setNewPlayerInputs] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDateTime(new Date().toISOString().slice(0, 16));
      setTeamOneName(defaultTeamOneName);
      setTeamTwoName(defaultTeamTwoName);
      setScoreOne("");
      setScoreTwo("");
      setTeam1Players([]);
      setTeam2Players([]);
      setNewPlayerInputs({});
      setError(null);
    }
  }, [open, defaultTeamOneName, defaultTeamTwoName]);

  // ELO preview computation
  const eloPreview: EloUpdate[] = useMemo(() => {
    if (team1Players.length === 0 || team2Players.length === 0) return [];
    const s1 = scoreOne === "" ? null : parseInt(scoreOne, 10);
    const s2 = scoreTwo === "" ? null : parseInt(scoreTwo, 10);
    if (s1 === null || s2 === null) return [];
    const teams = [
      { team: teamOneName, players: team1Players },
      { team: teamTwoName, players: team2Players },
    ];
    return computeGameUpdates(playerRatings, teams, s1, s2);
  }, [team1Players, team2Players, teamOneName, teamTwoName, scoreOne, scoreTwo, playerRatings]);

  const addPlayerToTeam = (teamIdx: number, playerName?: string) => {
    const name = (playerName ?? newPlayerInputs[teamIdx] ?? "").trim();
    if (!name) return;
    const target = teamIdx === 0 ? team1Players : team2Players;
    if (target.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    const newPlayer = { name, order: target.length };
    if (teamIdx === 0) {
      setTeam1Players([...team1Players, newPlayer]);
    } else {
      setTeam2Players([...team2Players, newPlayer]);
    }
    if (!playerName) setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
  };

  const removePlayerFromTeam = (teamIdx: number, playerName: string) => {
    if (teamIdx === 0) {
      setTeam1Players(team1Players.filter((p) => p.name !== playerName).map((p, i) => ({ ...p, order: i })));
    } else {
      setTeam2Players(team2Players.filter((p) => p.name !== playerName).map((p, i) => ({ ...p, order: i })));
    }
  };

  const handleSubmit = async () => {
    if (!dateTime || !teamOneName || !teamTwoName || scoreOne === "" || scoreTwo === "") {
      setError(t("errorPlayerNameRequired"));
      return;
    }
    if (team1Players.length === 0 || team2Players.length === 0) {
      setError(t("errorNeedMorePlayers"));
      return;
    }

    setSaving(true);
    setError(null);

    const teamsSnapshot = [
      { team: teamOneName, players: team1Players },
      { team: teamTwoName, players: team2Players },
    ];

    try {
      const res = await fetch(`/api/events/${eventId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateTime: new Date(dateTime).toISOString(),
          teamOneName,
          teamTwoName,
          scoreOne: parseInt(scoreOne, 10),
          scoreTwo: parseInt(scoreTwo, 10),
          teamsSnapshot,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error || t("errorCreatingPastGame"));
        setSaving(false);
        return;
      }

      const newEntry = await res.json();
      onSuccess(newEntry);
      onClose();
    } catch {
      setError(t("errorCreatingPastGame"));
    }
    setSaving(false);
  };

  const getAvailableSuggestions = (teamIdx: number) => {
    const currentNames = new Set(
      (teamIdx === 0 ? team1Players : team2Players).map((p) => p.name.toLowerCase())
    );
    return knownPlayers.filter((kp) => !currentNames.has(kp.name.toLowerCase()));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <AddCircleIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>{t("addHistoricalGame")}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>{t("addHistoricalGameDesc")}</Alert>

          {error && <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 2 }}>{error}</Alert>}

          <TextField
            label={t("dateTime")}
            type="datetime-local"
            value={dateTime}
            onChange={(e) => setDateTime(e.target.value)}
            fullWidth
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label={t("pastGameTeam1Name")}
              value={teamOneName}
              onChange={(e) => setTeamOneName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label={t("pastGameTeam2Name")}
              value={teamTwoName}
              onChange={(e) => setTeamTwoName(e.target.value)}
              fullWidth
              size="small"
            />
          </Stack>

          <Box sx={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
            py: 2, px: 3, borderRadius: 3,
            backgroundColor: alpha(theme.palette.action.hover, 0.04),
            border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
          }}>
            <ScoreRoller
              value={scoreOne}
              onChange={setScoreOne}
              teamName={teamOneName}
            />
            <Typography variant="h4" color="text.disabled" fontWeight={300}>:</Typography>
            <ScoreRoller
              value={scoreTwo}
              onChange={setScoreTwo}
              teamName={teamTwoName}
            />
          </Box>

          <Typography variant="subtitle2" fontWeight={700}>{t("selectPlayers")}</Typography>

          <Grid container spacing={2}>
            {[{ label: teamOneName, players: team1Players, idx: 0 }, { label: teamTwoName, players: team2Players, idx: 1 }].map(({ label, players, idx }) => (
              <Grid key={idx} size={{ xs: 12, sm: 6 }}>
                <Box sx={{
                  p: 2, borderRadius: 3,
                  backgroundColor: alpha(theme.palette.action.hover, 0.04),
                  border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
                }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{label}</Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, minHeight: 32 }}>
                    {players.map((p) => (
                      <Chip
                        key={p.name}
                        size="small"
                        variant="outlined"
                        label={p.name}
                        onDelete={() => removePlayerFromTeam(idx, p.name)}
                        sx={{ borderRadius: 2 }}
                      />
                    ))}
                  </Box>
                  <Box sx={{ mt: 1.5 }}>
                    <PlayerAutocomplete
                      value={newPlayerInputs[idx] ?? ""}
                      onChange={(val) => setNewPlayerInputs((prev) => ({ ...prev, [idx]: val }))}
                      onAdd={(name) => addPlayerToTeam(idx, name)}
                      suggestions={getAvailableSuggestions(idx)}
                      disabled={saving}
                      label={t("addPlayerToTeam")}
                    />
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>

          {/* ELO Preview */}
          {eloPreview.length > 0 && (
            <Box sx={{
              p: 2, borderRadius: 3,
              backgroundColor: alpha(theme.palette.action.hover, 0.04),
              border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
            }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                {t("ratings")} Preview
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                {eloPreview.map((update) => (
                  <Box key={update.name} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="body2">{update.name}</Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        {update.oldRating}
                      </Typography>
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        color={update.delta > 0 ? "success.main" : update.delta < 0 ? "error.main" : "text.primary"}
                      >
                        {update.delta > 0 ? "+" : ""}{update.delta}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        → {update.newRating}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t("cancel")}</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving} startIcon={<SaveIcon />}>
          {saving ? t("creatingPastGame") : t("createPastGame")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── History page ──────────────────────────────────────────────────────────────

export default function HistoryPage({ eventId }: { eventId: string }) {
  const t = useT();
  const _locale = detectLocale();
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const [title, setTitle] = useState("");
  const [teamOneName, setTeamOneName] = useState("");
  const [teamTwoName, setTeamTwoName] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [knownPlayers, setKnownPlayers] = useState<{ name: string; gamesPlayed: number; userId?: string | null }[]>([]);
  const [playerRatings, setPlayerRatings] = useState<{ name: string; rating: number; gamesPlayed: number }[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [showAddHistorical, setShowAddHistorical] = useState(false);
  const [eventPlayers, setEventPlayers] = useState<{ id: string; name: string }[]>([]);
  const [eventLocation, setEventLocation] = useState<string>("");
  const [eventLat, setEventLat] = useState<number | null>(null);
  const [eventLng, setEventLng] = useState<number | null>(null);
  const [cost, setCost] = useState<{ totalAmount: number; currency: string; payments: Array<{ playerName: string; amount: number; status: "paid" | "pending" }> } | null>(null);
  const isOwner = !!(session?.user && ownerId && session.user.id === ownerId);

  const load = useCallback(async () => {
    const [evRes, histRes, costRes] = await Promise.all([
      fetch(`/api/events/${eventId}`),
      fetch(`/api/events/${eventId}/history`),
      fetch(`/api/events/${eventId}/cost`).catch(() => null),
    ]);
    if (evRes.status === 404) { setNotFound(true); setLoading(false); return; }
    const ev = await evRes.json();
    const hist = await histRes.json();
    setTitle(ev.title);
    setTeamOneName(ev.teamOneName ?? "Team A");
    setTeamTwoName(ev.teamTwoName ?? "Team B");
    setOwnerId(ev.ownerId ?? null);
    setIsAdmin(!!ev.isAdmin);
    setTimezone(ev.timezone || "UTC");
    setEventLocation(ev.location ?? "");
    setEventLat(ev.latitude ?? null);
    setEventLng(ev.longitude ?? null);
    setEventPlayers((ev.players ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
    setHistory(hist.data);
    setNextCursor(hist.nextCursor);
    setHasMore(hist.hasMore);
    if (costRes && costRes.ok) {
      const costJson = await costRes.json();
      setCost(costJson);
    }
    setLoading(false);

    // Fetch known players (historical) and ratings in parallel (non-blocking)
    // Combine current event players with historical players for suggestions
    const currentPlayers = (ev.players ?? []).map((p: { name: string }) => ({ name: p.name, gamesPlayed: -1, userId: null })); // -1 indicates current player
    Promise.all([
      fetch(`/api/events/${eventId}/known-players`).then((r) => r.json()).catch(() => ({ players: [] })),
      fetch(`/api/events/${eventId}/ratings`).then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([kp, ratings]) => {
      // Combine current players with historical players, deduping by name
      const allPlayersMap = new Map<string, { name: string; gamesPlayed: number; userId: string | null }>();
      // Current players first (they get priority)
      currentPlayers.forEach((p: { name: string; gamesPlayed: number; userId: string | null }) => allPlayersMap.set(p.name.toLowerCase(), p));
      // Historical players (only if not already in current)
      (kp.players ?? []).forEach((p: { name: string; gamesPlayed: number; userId?: string | null }) => {
        if (!allPlayersMap.has(p.name.toLowerCase())) {
          allPlayersMap.set(p.name.toLowerCase(), { name: p.name, gamesPlayed: p.gamesPlayed, userId: p.userId ?? null });
        }
      });
      setKnownPlayers(Array.from(allPlayersMap.values()));
      setPlayerRatings(
        (ratings.data ?? []).map((r: { name: string; rating: number; gamesPlayed: number }) => ({ name: r.name, rating: r.rating, gamesPlayed: r.gamesPlayed }))
      );
    });
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetch(`/api/events/${eventId}/history?cursor=${nextCursor}`);
    const page = await res.json();
    setHistory((prev) => [...prev, ...page.data]);
    setNextCursor(page.nextCursor);
    setHasMore(page.hasMore);
    setLoadingMore(false);
  };

  const handleUpdate = (updated: HistoryEntry) => {
    setHistory((prev) => prev.map((h) => h.id === updated.id ? updated : h));
  };

  const handleDelete = (id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };

  const handleAddHistoricalSuccess = (newEntry: HistoryEntry) => {
    setHistory((prev) => [newEntry, ...prev]);
  };

  if (loading) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
          <CircularProgress />
        </Box>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  if (notFound) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>{t("gameNotFound")}</Typography>
          <Button variant="contained" href="/">{t("createNewGame")}</Button>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Button variant="outlined" startIcon={<ArrowBackIcon />} href={`/events/${eventId}`} size="small"
                sx={{ borderRadius: 2, textTransform: "none" }}>
                {t("backToGame")}
              </Button>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <HistoryIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>
                  {t("historyTitle", { title })}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
              {(isOwner || isAdmin) && (
                <Button variant="contained" startIcon={<AddCircleIcon />}
                  onClick={() => setShowAddHistorical(true)} size="small"
                  sx={{ borderRadius: 2, textTransform: "none" }}>
                  {t("addHistoricalGame")}
                </Button>
              )}
            </Box>

            {history.length === 0 ? (
              <Paper elevation={0} sx={{
                borderRadius: 4, p: 4, textAlign: "center",
                border: "1px solid",
                borderColor: "divider",
              }}>
                <SportsIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography variant="h6" color="text.secondary">{t("noHistory")}</Typography>
                <Typography variant="body2" color="text.disabled" mt={1}>{t("noHistoryDesc")}</Typography>
              </Paper>
            ) : (
              <>
                {history.map((entry) => (
                  <HistoryCardFull
                    key={entry.id}
                    entry={entry}
                    eventId={eventId}
                    event={{
                      id: eventId,
                      title,
                      location: eventLocation,
                      latitude: eventLat,
                      longitude: eventLng,
                      timezone,
                      ownerId,
                    }}
                    cost={cost}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    isAuthenticated={isAuthenticated}
                    isOwner={isOwner}
                    isAdmin={isAdmin}
                    knownPlayers={knownPlayers}
                    playerRatings={playerRatings}
                    userName={session?.user?.name ?? null}
                    eventPlayers={eventPlayers}
                  />
                ))}
                {hasMore && (
                  <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
                    <Button variant="outlined" onClick={loadMore} disabled={loadingMore}
                      sx={{ borderRadius: 2, textTransform: "none" }}>
                      {loadingMore ? t("loading") : t("loadMore")}
                    </Button>
                  </Box>
                )}
              </>
            )}
          </Stack>

          <AddHistoricalGameDialog
            open={showAddHistorical}
            onClose={() => setShowAddHistorical(false)}
            eventId={eventId}
            defaultTeamOneName={teamOneName}
            defaultTeamTwoName={teamTwoName}
            knownPlayers={knownPlayers}
            playerRatings={playerRatings}
            onSuccess={handleAddHistoricalSuccess}
          />
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
