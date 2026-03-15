import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button, Divider,
  CircularProgress, Alert, TextField, ToggleButton, ToggleButtonGroup,
  alpha, useTheme, IconButton, Tooltip, Grid2,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HistoryIcon from "@mui/icons-material/History";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import LockIcon from "@mui/icons-material/Lock";
import SaveIcon from "@mui/icons-material/Save";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";

interface TeamSnapshot {
  team: string;
  players: { name: string; order: number }[];
}

interface HistoryEntry {
  id: string;
  dateTime: string;
  status: "played" | "cancelled";
  scoreOne: number | null;
  scoreTwo: number | null;
  teamOneName: string;
  teamTwoName: string;
  teamsSnapshot: string | null;
  editableUntil: string;
  editable: boolean;
  eloUpdates?: { name: string; delta: number }[] | null;
}

function HistoryCardFull({
  entry,
  eventId,
  onUpdate,
}: {
  entry: HistoryEntry;
  eventId: string;
  onUpdate: (updated: HistoryEntry) => void;
}) {
  const t = useT();
  const locale = detectLocale();
  const theme = useTheme();
  const [scoreOne, setScoreOne] = useState(entry.scoreOne !== null ? String(entry.scoreOne) : "");
  const [scoreTwo, setScoreTwo] = useState(entry.scoreTwo !== null ? String(entry.scoreTwo) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teams: TeamSnapshot[] = entry.teamsSnapshot ? JSON.parse(entry.teamsSnapshot) : [];
  const date = new Date(entry.dateTime);
  const editableUntil = new Date(entry.editableUntil);
  const isCancelled = entry.status === "cancelled";

  const patch = async (data: object) => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json.error); return; }
    onUpdate(json);
  };

  const handleSaveScore = () => {
    const s1 = scoreOne === "" ? null : parseInt(scoreOne, 10);
    const s2 = scoreTwo === "" ? null : parseInt(scoreTwo, 10);
    patch({ scoreOne: isNaN(s1 as number) ? null : s1, scoreTwo: isNaN(s2 as number) ? null : s2 });
  };

  const statusColor = isCancelled ? "error" : "success";

  return (
    <Paper elevation={2} sx={{
      borderRadius: 3, overflow: "hidden",
      opacity: isCancelled ? 0.75 : 1,
      border: `1px solid ${alpha(isCancelled ? theme.palette.error.main : theme.palette.success.main, 0.2)}`,
    }}>
      {/* Header */}
      <Box sx={{
        px: 3, py: 2,
        backgroundColor: alpha(isCancelled ? theme.palette.error.main : theme.palette.success.main, 0.06),
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1,
      }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            {date.toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {date.toLocaleTimeString(locale === "pt" ? "pt-PT" : "en-GB", { hour: "2-digit", minute: "2-digit" })}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            icon={isCancelled ? <CancelIcon /> : <CheckCircleIcon />}
            label={isCancelled ? t("statusCancelled") : t("statusPlayed")}
            color={statusColor}
            size="small"
          />
          {!entry.editable && (
            <Tooltip title={t("notEditable")}>
              <LockIcon fontSize="small" color="disabled" />
            </Tooltip>
          )}
        </Stack>
      </Box>

      <Box sx={{ px: 3, py: 2 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

          {/* Score */}
          {!isCancelled && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>{t("score")}</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ textAlign: "center", minWidth: 80 }}>
                  <Typography variant="caption" color="text.secondary" noWrap>{entry.teamOneName}</Typography>
                  {entry.editable ? (
                    <TextField
                      size="small" type="number" value={scoreOne}
                      onChange={(e) => setScoreOne(e.target.value)}
                      inputProps={{ min: 0, max: 99, style: { textAlign: "center", fontWeight: 700, fontSize: "1.4rem" } }}
                      sx={{ width: 72 }}
                    />
                  ) : (
                    <Typography variant="h4" fontWeight={700}>
                      {entry.scoreOne !== null ? entry.scoreOne : "—"}
                    </Typography>
                  )}
                </Box>
                <Typography variant="h5" color="text.disabled" sx={{ pb: entry.editable ? 0 : 0 }}>–</Typography>
                <Box sx={{ textAlign: "center", minWidth: 80 }}>
                  <Typography variant="caption" color="text.secondary" noWrap>{entry.teamTwoName}</Typography>
                  {entry.editable ? (
                    <TextField
                      size="small" type="number" value={scoreTwo}
                      onChange={(e) => setScoreTwo(e.target.value)}
                      inputProps={{ min: 0, max: 99, style: { textAlign: "center", fontWeight: 700, fontSize: "1.4rem" } }}
                      sx={{ width: 72 }}
                    />
                  ) : (
                    <Typography variant="h4" fontWeight={700}>
                      {entry.scoreTwo !== null ? entry.scoreTwo : "—"}
                    </Typography>
                  )}
                </Box>
                {entry.editable && (
                  <Button variant="outlined" size="small" startIcon={<SaveIcon />}
                    onClick={handleSaveScore} disabled={saving}>
                    {t("saveScore")}
                  </Button>
                )}
              </Stack>
            </Box>
          )}

          {/* Teams snapshot */}
          {teams.length > 0 && !isCancelled && (
            <>
              <Divider />
              <Grid2 container spacing={2}>
                {teams.map((team) => (
                  <Grid2 key={team.team} size={{ xs: 12, sm: 6 }}>
                    <Typography variant="body2" fontWeight={700} gutterBottom>{team.team}</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {team.players.map((p) => {
                        const elo = entry.eloUpdates?.find((e) => e.name === p.name);
                        const deltaLabel = elo ? (elo.delta >= 0 ? `+${elo.delta}` : `${elo.delta}`) : null;
                        return (
                          <Chip
                            key={p.name} size="small" variant="outlined"
                            label={deltaLabel ? `${p.name} (${deltaLabel})` : p.name}
                            sx={elo ? {
                              borderColor: elo.delta > 0 ? "success.main" : elo.delta < 0 ? "error.main" : undefined,
                            } : undefined}
                          />
                        );
                      })}
                    </Box>
                  </Grid2>
                ))}
              </Grid2>
            </>
          )}

          {/* Status toggle */}
          {entry.editable && (
            <>
              <Divider />
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  size="small" variant={isCancelled ? "outlined" : "contained"} color="success"
                  startIcon={<CheckCircleIcon />} disabled={saving}
                  onClick={() => patch({ status: "played" })}
                >
                  {t("markPlayed")}
                </Button>
                <Button
                  size="small" variant={isCancelled ? "contained" : "outlined"} color="error"
                  startIcon={<CancelIcon />} disabled={saving}
                  onClick={() => patch({ status: "cancelled" })}
                >
                  {t("markCancelled")}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {t("editableUntil", {
                  date: editableUntil.toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB", {
                    day: "numeric", month: "short", year: "numeric",
                  }),
                })}
              </Typography>
            </>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}

export default function HistoryPage({ eventId }: { eventId: string }) {
  const t = useT();
  const locale = detectLocale();
  const [title, setTitle] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const [evRes, histRes] = await Promise.all([
      fetch(`/api/events/${eventId}`),
      fetch(`/api/events/${eventId}/history`),
    ]);
    if (evRes.status === 404) { setNotFound(true); setLoading(false); return; }
    const ev = await evRes.json();
    const hist = await histRes.json();
    setTitle(ev.title);
    setHistory(hist);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleUpdate = (updated: HistoryEntry) => {
    setHistory((prev) => prev.map((h) => h.id === updated.id ? updated : h));
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
              <Button variant="outlined" startIcon={<ArrowBackIcon />} href={`/events/${eventId}`} size="small">
                {t("backToGame")}
              </Button>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <HistoryIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>
                  {t("historyTitle", { title })}
                </Typography>
              </Box>
            </Box>

            {history.length === 0 ? (
              <Paper elevation={2} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                <SportsSoccerIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography variant="h6" color="text.secondary">{t("noHistory")}</Typography>
                <Typography variant="body2" color="text.disabled" mt={1}>{t("noHistoryDesc")}</Typography>
              </Paper>
            ) : (
              history.map((entry) => (
                <HistoryCardFull key={entry.id} entry={entry} eventId={eventId} onUpdate={handleUpdate} />
              ))
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
